export { detectPlatform } from './detectPlatform';
export { extractVideoId } from './extractVideoId';
export { getVideoMetadata } from './getVideoMetadata';
export { getComments } from './getComments';
export { cleanComments } from './cleanComments';
export {
  classifyBatch,
  classifyAllComments,
  CLASSIFY_BATCH_SIZE,
  CLASSIFY_DEFAULT_CONCURRENCY,
  CLASSIFY_PROGRESS_TICK_BATCHES,
  CLASSIFY_INTER_BATCH_DELAY_MS,
  INTENT_VALUES,
  SENTIMENT_VALUES,
  URGENCY_VALUES,
} from './classifyComments';
export {
  groupByTopic,
  pickRepresentatives,
  summarizeCluster,
  breakdownClusterRequests,
  clusterAllComments,
  extractThemes,
  CLUSTER_MIN_GROUP_SIZE,
  CLUSTER_DEFAULT_CONCURRENCY,
  CLUSTER_REPRESENTATIVE_COUNT,
  CLUSTER_TAIL_SAMPLE_COUNT,
  CLUSTER_LLM_FANOUT_CONCURRENCY,
} from './clusterComments';
export {
  scoreCluster,
  rankOpportunities,
  DEMAND_INTENT_WEIGHTS,
  DEMAND_WEIGHTS,
} from './demandScore';
export type { DemandScore } from './demandScore';
export {
  detectContentGaps,
  findUnansweredQuestions,
  detectEmergingTopics,
  CONTENT_GAPS_TOP_N,
  UNANSWERED_QUESTIONS_TOP_N,
  EMERGING_TOPICS_MIN_LATE_COUNT,
  EMERGING_TOPICS_MIN_GROWTH_RATIO,
} from './contentGaps';
export type { ContentGap, UnansweredQuestion, EmergingTopic } from './contentGaps';
export type {
  Platform,
  VideoMetadata,
  RawComment,
  CleaningStats,
  ClassifiedComment,
  ClusterSummary,
  RequestBreakdown,
  TailCluster,
  ExtractThemesResult,
  CommentIntent,
  Sentiment,
  Urgency,
} from './types';
