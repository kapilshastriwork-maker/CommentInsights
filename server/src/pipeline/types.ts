export type Platform = 'youtube' | 'instagram' | 'unknown';

export interface VideoMetadata {
  videoId: string;
  title: string;
  description: string;
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

export type CommentIntent =
  | 'content_request'
  | 'question'
  | 'agree_validate'
  | 'share_experience'
  | 'disagree_debate'
  | 'confusion'
  | 'praise'
  | 'other';

export type Sentiment = 'positive' | 'neutral' | 'negative';
export type Urgency = 'low' | 'medium' | 'high';

export interface ClassifiedComment {
  id: string;
  text: string;
  intent: CommentIntent;
  topic: string;
  subtopic: string;
  sentiment: Sentiment;
  urgency: Urgency;
  explicit_request: boolean;
}

export interface ClusterSummary {
  topic: string;
  size: number;
  representativeComments: string[];
  intentBreakdown: Record<CommentIntent, number>;
  sentimentBreakdown: Record<Sentiment, number>;
  urgencyBreakdown: Record<Urgency, number>;
  dominantIntent: CommentIntent;
  dominantSentiment: Sentiment;
  averageUrgency: number;
  themeLabel: string;
  themeDescription: string;
  explicitRequestCount: number;
  isUnknownTopic: boolean;
  requestBreakdown: RequestBreakdown[] | null;
}

export interface RequestBreakdown {
  label: string;
  count: number;
}

export interface TailCluster {
  topic: string;
  size: number;
  sampleCommentTexts: string[];
  isUnknownTopic: boolean;
}

export interface ExtractThemesResult {
  summarized: ClusterSummary[];
  tail: TailCluster[];
}
