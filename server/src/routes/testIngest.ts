import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  cleanComments,
  detectPlatform,
  getComments,
  getVideoMetadata,
} from '../pipeline';

const router = Router();
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

router.get('/', async (req: Request, res: Response) => {
  const url = String(req.query.url ?? '').trim();
  if (!url) {
    return res
      .status(400)
      .json({ error: 'missing_url', message: 'Query param "url" is required.' });
  }

  try {
    const platform = detectPlatform(url);
    if (platform !== 'youtube') {
      return res.status(400).json({
        error: 'unsupported_platform',
        message: `Only YouTube URLs are supported right now. Detected platform: "${platform}".`,
        platform,
      });
    }

    console.log(`[test-ingest] start url=${url}`);
    const metadata = await getVideoMetadata(url);
    console.log(
      `[test-ingest] metadata videoId=${metadata.videoId} title="${metadata.title}"`,
    );

    const raw = await getComments(metadata.videoId, 3000);
    console.log(
      `[test-ingest] fetched raw comments: ${raw.length} for videoId=${metadata.videoId}`,
    );

    const { cleaned, stats } = cleanComments(raw);

    await fs.mkdir(DATA_DIR, { recursive: true });
    const rawPath = path.join(DATA_DIR, `${metadata.videoId}-raw.json`);
    const cleanedPath = path.join(DATA_DIR, `${metadata.videoId}-cleaned.json`);
    await Promise.all([
      fs.writeFile(rawPath, JSON.stringify(raw, null, 2), 'utf8'),
      fs.writeFile(cleanedPath, JSON.stringify(cleaned, null, 2), 'utf8'),
    ]);
    console.log(
      `[test-ingest] wrote ${rawPath} (${raw.length} comments) and ${cleanedPath} (${cleaned.length} comments)`,
    );

    return res.json({
      platform,
      metadata,
      totalCommentsFetched: raw.length,
      totalCommentsAfterCleaning: cleaned.length,
      cleaningStats: stats,
      sample: cleaned.slice(0, 5),
      files: { raw: rawPath, cleaned: cleanedPath },
    });
  } catch (err: any) {
    console.error(`[test-ingest] error:`, err?.message ?? err);
    return res.status(500).json({
      error: 'ingest_failed',
      message: err?.message ?? String(err),
    });
  }
});

export default router;
