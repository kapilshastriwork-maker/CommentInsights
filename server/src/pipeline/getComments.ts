import axios, { AxiosError } from 'axios';
import type { RawComment } from './types';

const YT_COMMENT_THREADS_ENDPOINT =
  'https://www.googleapis.com/youtube/v3/commentThreads';

const GRACEFUL_REASONS = new Set<string>([
  'quotaExceeded',
  'rateLimitExceeded',
  'commentsDisabled',
  'commentsNotAllowed',
  'commentHistoryNotFound',
  'invalidParameter',
  'backendError',
  'internalError',
]);

function extractReason(errBody: any): string | undefined {
  return errBody?.error?.errors?.[0]?.reason;
}

export async function getComments(
  videoId: string,
  maxResults = 3000,
): Promise<RawComment[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'YOUTUBE_API_KEY is not set. Add it to your .env file (see .env.example).',
    );
  }
  if (!videoId) {
    throw new Error('getComments: videoId is required.');
  }

  const collected: RawComment[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;

  while (collected.length < maxResults) {
    const remaining = maxResults - collected.length;
    const pageSize = Math.min(100, remaining);

    let response;
    try {
      response = await axios.get(YT_COMMENT_THREADS_ENDPOINT, {
        params: {
          part: 'snippet',
          videoId,
          order: 'relevance',
          maxResults: pageSize,
          pageToken,
          key: apiKey,
          textFormat: 'plainText',
        },
        timeout: 20000,
      });
    } catch (err) {
      const ax = err as AxiosError<any>;
      if (ax.response) {
        const reason = extractReason(ax.response.data);
        const status = ax.response.status;
        const message =
          ax.response.data?.error?.message ?? ax.message ?? 'unknown error';

        if (GRACEFUL_REASONS.has(reason ?? '') || status === 429) {
          console.warn(
            `[getComments] graceful stop on page ${pageCount} ` +
              `(status=${status}, reason=${reason ?? 'n/a'}): ${message}. ` +
              `Returning ${collected.length} comments fetched so far.`,
          );
          return collected;
        }

        throw new Error(
          `YouTube commentThreads.list failed (${status}` +
            (reason ? `, reason=${reason}` : '') +
            `): ${message}`,
        );
      }
      throw new Error(`YouTube commentThreads.list request failed: ${ax.message}`);
    }

    const items: any[] = response.data?.items ?? [];
    for (const item of items) {
      const top = item?.snippet?.topLevelComment?.snippet;
      if (!top) continue;
      collected.push({
        id: String(item.id ?? top.commentId ?? ''),
        author: String(top.authorDisplayName ?? ''),
        text: String(top.textDisplay ?? top.textOriginal ?? ''),
        likeCount: Number(top.likeCount ?? 0),
        publishedAt: String(top.publishedAt ?? ''),
      });
    }

    pageCount += 1;

    const nextToken: string | undefined = response.data?.nextPageToken;
    if (!nextToken) break;
    pageToken = nextToken;
  }

  return collected;
}
