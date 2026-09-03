export type Platform = 'youtube' | 'instagram' | 'unknown';

export interface VideoMetadata {
  videoId: string;
  title: string;
  channelTitle: string;
  viewCount: number | null;
  commentCount: number | null;
  publishedAt: string;
}

export interface RawComment {
  id: string;
  author: string;
  text: string;
  likeCount: number;
  publishedAt: string;
}

export interface CleaningStats {
  input: number;
  kept: number;
  removedShort: number;
  removedEmojiOnly: number;
  removedDuplicate: number;
  removedAtReply: number;
  totalRemoved: number;
}

export interface AnalysisResult {
  platform: Platform;
  metadata: VideoMetadata;
  totalCommentsFetched: number;
  totalCommentsAfterCleaning: number;
  cleaningStats: CleaningStats;
  sample: RawComment[];
  files?: { raw: string; cleaned: string };
}
