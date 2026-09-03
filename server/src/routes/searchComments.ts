import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { ClassifiedComment } from '../pipeline';

const router = Router();
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const MAX_MATCHES = 50;
const MIN_QUERY_LENGTH = 2;

interface ClassifiedCacheFile {
  videoId: string;
  classifiedAt: string;
  classified: ClassifiedComment[];
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
  const videoId = String(req.query.videoId ?? '').trim();
  const query = String(req.query.q ?? '').trim();

  if (!videoId) {
    return res
      .status(400)
      .json({ error: 'missing_videoId', message: 'Query param "videoId" is required.' });
  }
  if (!query) {
    return res
      .status(400)
      .json({ error: 'missing_query', message: 'Query param "q" is required.' });
  }
  if (query.length < MIN_QUERY_LENGTH) {
    return res.status(400).json({
      error: 'query_too_short',
      message: `Query must be at least ${MIN_QUERY_LENGTH} characters.`,
    });
  }

  const classifiedPath = path.join(DATA_DIR, `${videoId}-classified.json`);
  const cached = await readJsonIfExists<ClassifiedCacheFile>(classifiedPath);
  if (!cached || !Array.isArray(cached.classified) || cached.classified.length === 0) {
    return res.status(404).json({
      error: 'classified_cache_missing',
      message:
        `No classified cache found for videoId=${videoId}. ` +
        `Run analyze_video(url) first to populate the classified cache.`,
      videoId,
      classifiedPath,
    });
  }

  const needle = query.toLowerCase();
  const matches: ClassifiedComment[] = [];
  for (const c of cached.classified) {
    if (typeof c.text === 'string' && c.text.toLowerCase().includes(needle)) {
      matches.push(c);
      if (matches.length >= MAX_MATCHES) break;
    }
  }

  return res.json({
    videoId,
    query,
    matchCount: matches.length,
    truncated: matches.length >= MAX_MATCHES,
    matches,
  });
});

export default router;
