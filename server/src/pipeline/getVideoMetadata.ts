import axios, { AxiosError } from 'axios';
import { extractVideoId } from './extractVideoId';
import type { VideoMetadata } from './types';

const YT_VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';

export async function getVideoMetadata(url: string): Promise<VideoMetadata> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'YOUTUBE_API_KEY is not set. Add it to your .env file (see .env.example).',
    );
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error(
      `Could not extract a YouTube video ID from URL: "${url}". ` +
        'Expected formats: https://www.youtube.com/watch?v=<id>, https://youtu.be/<id>, or https://www.youtube.com/shorts/<id>.',
    );
  }

  let response;
  try {
    response = await axios.get(YT_VIDEOS_ENDPOINT, {
      params: {
        part: 'snippet,statistics',
        id: videoId,
        key: apiKey,
      },
      timeout: 15000,
    });
  } catch (err) {
    const ax = err as AxiosError<any>;
    if (ax.response) {
      const apiError = ax.response.data?.error;
      const reason = apiError?.errors?.[0]?.reason;
      const message = apiError?.message ?? ax.message;
      throw new Error(
        `YouTube videos.list failed (${ax.response.status}${reason ? `, reason=${reason}` : ''}): ${message}`,
      );
    }
    throw new Error(`YouTube videos.list request failed: ${ax.message}`);
  }

  const items = response.data?.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(
      `YouTube returned no items for videoId="${videoId}". The video may be private, deleted, or region-restricted.`,
    );
  }

  const item = items[0];
  const snippet = item.snippet ?? {};
  const stats = item.statistics ?? {};

  const parseCount = (v: unknown): number | null => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    videoId,
    title: String(snippet.title ?? ''),
    description: String(snippet.description ?? ''),
    channelTitle: String(snippet.channelTitle ?? ''),
    viewCount: parseCount(stats.viewCount),
    commentCount: parseCount(stats.commentCount),
    publishedAt: String(snippet.publishedAt ?? ''),
  };
}
