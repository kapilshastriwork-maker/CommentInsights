import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  classifyAllComments,
  cleanComments,
  detectPlatform,
  getComments,
  getVideoMetadata,
  INTENT_VALUES,
  RawComment,
  SENTIMENT_VALUES,
  URGENCY_VALUES,
} from '../pipeline';
import { chatJSON as nvidiaChatJSON, DEFAULT_NVIDIA_MODEL } from '../nvidiaClient';
import { chatJSON as groqChatJSON, DEFAULT_GROQ_MODEL } from '../groqClient';

const router = Router();
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SUBSET_MAX_LIMIT = 500;

function tallyField(
  rows: ReadonlyArray<object>,
  field: string,
  values: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = 0;
  for (const r of rows) {
    const v = (r as Record<string, unknown>)[field];
    if (typeof v === 'string' && v in out) out[v] += 1;
  }
  return out;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch (err: any) {
    if (err && (err.code === 'ENOENT' || err.name === 'SyntaxError')) {
      return null;
    }
    throw err;
  }
}

router.get('/', async (req: Request, res: Response) => {
  const probeRaw = String(req.query.probe ?? '').toLowerCase();
  if (probeRaw === '1' || probeRaw === 'true' || probeRaw === 'yes') {
    const provider = (process.env.LLM_PROVIDER ?? 'nvidia').toLowerCase();
    const model = provider === 'groq' ? DEFAULT_GROQ_MODEL : DEFAULT_NVIDIA_MODEL;
    const chatFn = provider === 'groq' ? groqChatJSON : nvidiaChatJSON;
    const t0 = Date.now();
    try {
      const raw = await chatFn<any>(
        'Return one JSON object only.',
        'Reply with exactly this JSON and nothing else: {"ok":true,"echo":"hello"}',
        model,
      );
      return res.json({
        probe: true,
        provider,
        model,
        wallMs: Date.now() - t0,
        raw,
        rawType: typeof raw,
        rawIsObject: typeof raw === 'object' && raw !== null,
      });
    } catch (err: any) {
      const errBody = {
        status: err?.status ?? err?.response?.status,
        code: err?.error?.code,
        type: err?.error?.type,
        param: err?.error?.param,
        message: err?.message,
        error: err?.error,
        headers: err?.headers ?? err?.response?.headers,
        name: err?.name,
        constructor: err?.constructor?.name,
        ownKeys: Object.getOwnPropertyNames(err),
        rawResponseBody: err?.response?.data ?? err?.response?.body ?? err?.errorResponseBody ?? null,
      };
      console.error('[test-classify probe] call failed:', JSON.stringify(errBody, null, 2));
      return res.status(200).json({
        probe: true,
        provider,
        model,
        wallMs: Date.now() - t0,
        ok: false,
        error: errBody,
      });
    }
  }

  const url = String(req.query.url ?? '').trim();
  if (!url) {
    return res
      .status(400)
      .json({ error: 'missing_url', message: 'Query param "url" is required.' });
  }

  const forceRaw = String(req.query.force ?? '').toLowerCase();
  const force = forceRaw === 'true' || forceRaw === '1' || forceRaw === 'yes';

  let limit: number | null = null;
  const limitRaw = req.query.limit;
  if (limitRaw !== undefined && String(limitRaw).trim() !== '') {
    const parsed = Number(limitRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return res.status(400).json({
        error: 'invalid_limit',
        message: `Query param "limit" must be a positive integer (got "${limitRaw}").`,
      });
    }
    if (parsed > SUBSET_MAX_LIMIT) {
      return res.status(400).json({
        error: 'limit_too_large',
        message: `Query param "limit" must be <= ${SUBSET_MAX_LIMIT} (got ${parsed}). ` +
          `Drop the limit param to run the full classification.`,
      });
    }
    limit = Math.floor(parsed);
  }
  const isSubset = limit !== null;

  const tStart = Date.now();

  try {
    const platform = detectPlatform(url);
    if (platform !== 'youtube') {
      return res.status(400).json({
        error: 'unsupported_platform',
        message: `Only YouTube URLs are supported right now. Detected platform: "${platform}".`,
        platform,
      });
    }

    console.log(`[test-classify] start url=${url} force=${force} limit=${limit ?? 'none'}`);
    const metadata = await getVideoMetadata(url);
    const { videoId } = metadata;
    console.log(
      `[test-classify] metadata videoId=${videoId} title="${metadata.title}"`,
    );

    const classifiedPath = path.join(DATA_DIR, `${videoId}-classified.json`);
    const cleanedPath = path.join(DATA_DIR, `${videoId}-cleaned.json`);
    const rawPath = path.join(DATA_DIR, `${videoId}-raw.json`);

    if (!force) {
      const cached = await readJsonIfExists<{
        videoId: string;
        classifiedAt: string;
        classified: any[];
      }>(classifiedPath);
      if (cached && Array.isArray(cached.classified) && cached.classified.length > 0) {
        const classified = cached.classified as any[];
        const intentBreakdown = tallyField(classified, 'intent', INTENT_VALUES);
        const sentimentBreakdown = tallyField(
          classified,
          'sentiment',
          SENTIMENT_VALUES,
        );
        const urgencyBreakdown = tallyField(classified, 'urgency', URGENCY_VALUES);
        console.log(
          `[test-classify] cache hit: ${classified.length} comments from ${cached.classifiedAt}`,
        );
        return res.json({
          platform,
          metadata,
          fromCache: true,
          force: false,
          cachedAt: cached.classifiedAt,
          totalCommentsFetched: null,
          totalCommentsAfterCleaning: classified.length,
          totalClassified: classified.length,
          intentBreakdown,
          sentimentBreakdown,
          urgencyBreakdown,
          classifiedSample: classified.slice(0, 10),
          timing: { totalMs: Date.now() - tStart, classifyMs: 0 },
          files: { raw: null, cleaned: cleanedPath, classified: classifiedPath },
        });
      }
    }

    let cleaned: RawComment[];
    let totalFetched: number | null = null;
    const cachedCleaned = await readJsonIfExists<RawComment[]>(cleanedPath);
    if (cachedCleaned && Array.isArray(cachedCleaned) && cachedCleaned.length > 0) {
      cleaned = cachedCleaned;
      console.log(
        `[test-classify] reused cleaned cache: ${cleaned.length} comments from ${cleanedPath}`,
      );
    } else {
      console.log(`[test-classify] no cleaned cache; fetching + cleaning…`);
      const raw = await getComments(videoId, 3000);
      totalFetched = raw.length;
      console.log(`[test-classify] fetched raw comments: ${raw.length}`);
      const { cleaned: c } = cleanComments(raw);
      cleaned = c;
      await fs.mkdir(DATA_DIR, { recursive: true });
      await Promise.all([
        fs.writeFile(rawPath, JSON.stringify(raw, null, 2), 'utf8'),
        fs.writeFile(cleanedPath, JSON.stringify(cleaned, null, 2), 'utf8'),
      ]);
      console.log(
        `[test-classify] wrote ${rawPath} (${raw.length}) and ${cleanedPath} (${cleaned.length})`,
      );
    }

    const cleanedForClassify = isSubset ? cleaned.slice(0, limit!) : cleaned;
    if (isSubset) {
      console.log(
        `[test-classify] subset mode: classifying first ${cleanedForClassify.length} of ${cleaned.length} cleaned comments (cache write skipped)`,
      );
    }

    const tClassifyStart = Date.now();
    const classified = await classifyAllComments(
      cleanedForClassify.map((c) => ({ id: c.id, text: c.text })),
      { concurrency: 1 },
    );
    const classifyMs = Date.now() - tClassifyStart;

    const intentBreakdown = tallyField(classified, 'intent', INTENT_VALUES);
    const sentimentBreakdown = tallyField(
      classified,
      'sentiment',
      SENTIMENT_VALUES,
    );
    const urgencyBreakdown = tallyField(classified, 'urgency', URGENCY_VALUES);

    if (isSubset) {
      console.log(
        `[test-classify] subset done: ${classified.length} comments in ${classifyMs}ms (cache NOT written; subset run)`,
      );
    } else {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const cachePayload = {
        videoId,
        classifiedAt: new Date().toISOString(),
        classified,
      };
      await fs.writeFile(classifiedPath, JSON.stringify(cachePayload, null, 2), 'utf8');
      console.log(
        `[test-classify] wrote ${classifiedPath} (${classified.length} classified) in ${classifyMs}ms`,
      );
    }

    return res.json({
      platform,
      metadata,
      fromCache: false,
      force,
      subset: isSubset ? { limit: limit!, cleanedAvailable: cleaned.length } : null,
      cachedAt: isSubset ? null : new Date().toISOString(),
      totalCommentsFetched: totalFetched,
      totalCommentsAfterCleaning: cleaned.length,
      totalClassified: classified.length,
      intentBreakdown,
      sentimentBreakdown,
      urgencyBreakdown,
      classifiedSample: classified.slice(0, 10),
      timing: { totalMs: Date.now() - tStart, classifyMs },
      files: {
        raw: totalFetched !== null ? rawPath : null,
        cleaned: cleanedPath,
        classified: isSubset ? null : classifiedPath,
      },
    });
  } catch (err: any) {
    console.error(`[test-classify] error:`, err?.message ?? err);
    return res.status(500).json({
      error: 'classify_failed',
      message: err?.message ?? String(err),
    });
  }
});

export default router;
