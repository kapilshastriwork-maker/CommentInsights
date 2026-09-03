import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  clusterAllComments,
  ClassifiedComment,
  ClusterSummary,
  CommentIntent,
  ContentGap,
  DemandScore,
  detectContentGaps,
  detectEmergingTopics,
  EmergingTopic,
  findUnansweredQuestions,
  INTENT_VALUES,
  RawComment,
  rankOpportunities,
  SENTIMENT_VALUES,
  Sentiment,
  TailCluster,
  UnansweredQuestion,
} from '../pipeline';
import { detectPlatform, getVideoMetadata } from '../pipeline';

const router = Router();
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

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

function tallyField(
  rows: ReadonlyArray<ClassifiedComment>,
  field: 'intent' | 'sentiment',
  values: readonly CommentIntent[] | readonly Sentiment[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = 0;
  for (const r of rows) {
    const v = (r as unknown as Record<string, unknown>)[field];
    if (typeof v === 'string' && v in out) out[v] += 1;
  }
  return out;
}

interface ClassifiedCacheFile {
  videoId: string;
  classifiedAt: string;
  classified: ClassifiedComment[];
}

interface ClustersCacheFile {
  videoId: string;
  clusteredAt: string;
  classifiedAt: string;
  summarized: ClusterSummary[];
  tail: TailCluster[];
}

router.get('/', async (req: Request, res: Response) => {
  const url = String(req.query.url ?? '').trim();
  if (!url) {
    return res
      .status(400)
      .json({ error: 'missing_url', message: 'Query param "url" is required.' });
  }

  const forceRaw = String(req.query.force ?? '').toLowerCase();
  const force = forceRaw === 'true' || forceRaw === '1' || forceRaw === 'yes';

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

    console.log(`[test-intelligence] start url=${url} force=${force}`);
    const metadata = await getVideoMetadata(url);
    const { videoId } = metadata;
    console.log(
      `[test-intelligence] metadata videoId=${videoId} title="${metadata.title}"`,
    );

    const classifiedPath = path.join(DATA_DIR, `${videoId}-classified.json`);
    const clustersPath = path.join(DATA_DIR, `${videoId}-clusters.json`);
    const rawPath = path.join(DATA_DIR, `${videoId}-raw.json`);

    const classifiedCache = await readJsonIfExists<ClassifiedCacheFile>(classifiedPath);
    if (!classifiedCache || !Array.isArray(classifiedCache.classified) || classifiedCache.classified.length === 0) {
      console.log(
        `[test-intelligence] no classified cache at ${classifiedPath}; refusing to score without it`,
      );
      return res.status(400).json({
        error: 'classified_cache_missing',
        message:
          `No classified cache found for videoId=${videoId}. ` +
          `Run /api/test-classify?url=...&force=true first to populate the classified cache.`,
        videoId,
        classifiedPath,
      });
    }

    const rawCache = await readJsonIfExists<RawComment[]>(rawPath);
    if (!rawCache || !Array.isArray(rawCache) || rawCache.length === 0) {
      console.log(
        `[test-intelligence] no raw cache at ${rawPath}; cannot compute emergingTopics without raw publishedAt timestamps`,
      );
    }

    const totalClassified = classifiedCache.classified.length;

    const intentBreakdown = tallyField(
      classifiedCache.classified,
      'intent',
      INTENT_VALUES,
    );
    const sentimentBreakdown = tallyField(
      classifiedCache.classified,
      'sentiment',
      SENTIMENT_VALUES,
    );

    let summarized: ClusterSummary[] = [];
    let tail: TailCluster[] = [];
    let clustersFromCache = false;
    let clustersRecomputed = false;
    let clustersCachedAt: string | null = null;

    if (!force) {
      const cachedClusters = await readJsonIfExists<ClustersCacheFile>(clustersPath);
      if (
        cachedClusters &&
        Array.isArray(cachedClusters.summarized) &&
        Array.isArray(cachedClusters.tail) &&
        cachedClusters.summarized.every((s) => 'requestBreakdown' in s)
      ) {
        summarized = cachedClusters.summarized;
        tail = cachedClusters.tail;
        clustersCachedAt = cachedClusters.clusteredAt;
        clustersFromCache = true;
        console.log(
          `[test-intelligence] using cached clusters (${summarized.length} + ${tail.length} tail) from ${cachedClusters.clusteredAt}`,
        );
      }
    }

    if (force || summarized.length === 0) {
      console.log(
        `[test-intelligence] force=${force} (or cache miss); running clusterAllComments on ${totalClassified} classified comments…`,
      );
      const tClusterStart = Date.now();
      const fresh = await clusterAllComments(classifiedCache.classified);
      const clusterMs = Date.now() - tClusterStart;
      summarized = fresh.summarized;
      tail = fresh.tail;
      clustersRecomputed = true;
      const now = new Date().toISOString();
      const cachePayload: ClustersCacheFile = {
        videoId,
        clusteredAt: now,
        classifiedAt: classifiedCache.classifiedAt,
        summarized,
        tail,
      };
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(clustersPath, JSON.stringify(cachePayload, null, 2), 'utf8');
      console.log(
        `[test-intelligence] wrote ${clustersPath} (${summarized.length} clusters + ${tail.length} tail) in ${clusterMs}ms`,
      );
    }

    const tScoreStart = Date.now();
    const ranked: DemandScore[] = rankOpportunities(summarized, totalClassified);
    const scoreMs = Date.now() - tScoreStart;
    console.log(
      `[test-intelligence] ranked ${ranked.length} clusters in ${scoreMs}ms (top: "${ranked[0]?.topic}"=${ranked[0]?.score ?? 'n/a'})`,
    );

    const tIntelligenceStart = Date.now();
    const rawCommentsForEmerging = rawCache ?? [];
    const [contentGaps, unansweredQuestions, emergingTopics] = await Promise.all([
      detectContentGaps(summarized, ranked, metadata),
      Promise.resolve(findUnansweredQuestions(classifiedCache.classified)),
      Promise.resolve(detectEmergingTopics(classifiedCache.classified, rawCommentsForEmerging)),
    ]);
    const intelligenceMs = Date.now() - tIntelligenceStart;

    console.log(
      `[test-intelligence] intelligence: ${contentGaps.length} gaps, ${unansweredQuestions.length} question topics, ${emergingTopics.length} emerging topics in ${intelligenceMs}ms`,
    );

    const gapsTyped: ContentGap[] = contentGaps;
    const unansweredTyped: UnansweredQuestion[] = unansweredQuestions;
    const emergingTyped: EmergingTopic[] = emergingTopics;

    return res.json({
      videoId,
      platform,
      metadata,
      fromCache: clustersFromCache,
      force,
      totalClassified,
      intentBreakdown,
      sentimentBreakdown,
      totalSummarizedClusters: summarized.length,
      totalTailClusters: tail.length,
      clustersRecomputed,
      clustersCachedAt,
      rankedOpportunities: ranked,
      contentGaps: gapsTyped,
      unansweredQuestions: unansweredTyped,
      emergingTopics: emergingTyped,
      rawCachePresent: rawCache !== null,
      timing: {
        totalMs: Date.now() - tStart,
        scoreMs,
        intelligenceMs,
      },
      files: { classified: classifiedPath, clusters: clustersPath, raw: rawPath },
    });
  } catch (err: any) {
    console.error(`[test-intelligence] error:`, err?.message ?? err);
    return res.status(500).json({
      error: 'intelligence_failed',
      message: err?.message ?? String(err),
    });
  }
});

export default router;
