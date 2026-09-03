import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  clusterAllComments,
  ClassifiedComment,
  ClusterSummary,
  DemandScore,
  detectPlatform,
  getVideoMetadata,
  rankOpportunities,
  TailCluster,
} from '../pipeline';

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

    console.log(`[test-demand] start url=${url} force=${force}`);
    const metadata = await getVideoMetadata(url);
    const { videoId } = metadata;
    console.log(
      `[test-demand] metadata videoId=${videoId} title="${metadata.title}"`,
    );

    const classifiedPath = path.join(DATA_DIR, `${videoId}-classified.json`);
    const clustersPath = path.join(DATA_DIR, `${videoId}-clusters.json`);

    const classifiedCache = await readJsonIfExists<ClassifiedCacheFile>(classifiedPath);
    if (!classifiedCache || !Array.isArray(classifiedCache.classified) || classifiedCache.classified.length === 0) {
      console.log(
        `[test-demand] no classified cache at ${classifiedPath}; refusing to score without it`,
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

    const totalClassified = classifiedCache.classified.length;

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
          `[test-demand] using cached clusters (${summarized.length} + ${tail.length} tail) from ${cachedClusters.clusteredAt}`,
        );
      }
    }

    if (force || summarized.length === 0) {
      console.log(
        `[test-demand] force=${force} (or cache miss); running clusterAllComments on ${totalClassified} classified comments…`,
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
        `[test-demand] wrote ${clustersPath} (${summarized.length} clusters + ${tail.length} tail) in ${clusterMs}ms`,
      );
    }

    const tScoreStart = Date.now();
    const ranked: DemandScore[] = rankOpportunities(summarized, totalClassified);
    const scoreMs = Date.now() - tScoreStart;
    console.log(
      `[test-demand] ranked ${ranked.length} clusters in ${scoreMs}ms (top: "${ranked[0]?.topic}"=${ranked[0]?.score ?? 'n/a'})`,
    );

    return res.json({
      videoId,
      platform,
      metadata,
      fromCache: clustersFromCache,
      force,
      totalClassified,
      totalSummarizedClusters: summarized.length,
      totalTailClusters: tail.length,
      clustersRecomputed,
      clustersCachedAt,
      rankedOpportunities: ranked,
      timing: {
        totalMs: Date.now() - tStart,
        scoreMs,
      },
      files: { classified: classifiedPath, clusters: clustersPath },
    });
  } catch (err: any) {
    console.error(`[test-demand] error:`, err?.message ?? err);
    return res.status(500).json({
      error: 'demand_failed',
      message: err?.message ?? String(err),
    });
  }
});

export default router;
