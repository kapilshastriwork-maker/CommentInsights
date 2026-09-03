/**
 * Phase 4 part 2 — Content Intelligence Layer.
 *
 * Three independent functions that produce content-gap signals on top of
 * the Phase 3 clusters + Phase 4 part 1 demand scores:
 *
 *   1. detectContentGaps     — LLM judges whether each high-demand cluster's
 *                              topic is covered by the video (title + description
 *                              only). Returns only the not_covered /
 *                              partially_covered clusters, sorted by demand.
 *
 *   2. findUnansweredQuestions — pure-computation; filters classified comments
 *                              by intent=question, groups by topic, returns top N.
 *                              Note: "unanswered" is a misnomer — without a
 *                              transcript we can't tell if the video answered
 *                              them. We surface "audience-asked questions" only.
 *                              Phase 9 polish: rename to `findAudienceQuestions`.
 *
 *   3. detectEmergingTopics  — pure-computation; within-video early-vs-late
 *                              mention-share comparison by publishedAt timestamp.
 *                              IMPORTANT: this is a within-video snapshot, NOT
 *                              a cross-video trend. True cross-video trend
 *                              analysis requires historical data across
 *                              multiple videos (Phase 8 stretch goal).
 */

import { chatJSON as groqChatJSON } from '../groqClient';
import { chatJSON as nvidiaChatJSON } from '../nvidiaClient';
import {
  groupByTopic,
  pickRepresentatives,
  ClusterSummary,
  ClassifiedComment,
  DemandScore,
  VideoMetadata,
} from './index';

const LLM_PROVIDER = (process.env.LLM_PROVIDER ?? 'groq').toLowerCase();
console.log(`[contentGaps] LLM_PROVIDER=${LLM_PROVIDER}`);
const chatJSON: typeof groqChatJSON =
  LLM_PROVIDER === 'groq' ? groqChatJSON : nvidiaChatJSON;

export const CONTENT_GAPS_TOP_N = 10;
export const UNANSWERED_QUESTIONS_TOP_N = 10;
export const EMERGING_TOPICS_MIN_LATE_COUNT = 3;
export const EMERGING_TOPICS_MIN_GROWTH_RATIO = 1.5;

export interface ContentGap {
  topic: string;
  demandScore: number;
  coverageStatus: 'covered' | 'partially_covered' | 'not_covered';
  reasoning: string;
}

export interface UnansweredQuestion {
  topic: string;
  questionCount: number;
  representativeQuestions: string[];
}

export interface EmergingTopic {
  topic: string;
  earlyCount: number;
  lateCount: number;
  growthRatio: number;
}

function normalizeTopicKey(t: string): string {
  return (t ?? '').trim().toLowerCase();
}

const SYSTEM_PROMPT_GAP_DETECTION = `You judge whether a YouTube video covers specific audience-request topics.

CRITICAL CONSTRAINTS:
- You only see the video's TITLE and DESCRIPTION. You have NOT watched the video.
- When uncertain, default to "not_covered" or "partially_covered" — NOT "covered".
- "partially_covered" = the title/description suggests adjacent content but the specific topic may not be in this video.
- "not_covered" = the title/description does not suggest this topic at all.
- "covered" = the title/description clearly states this topic is part of the video.
- Be conservative. False positives (marking uncovered things as covered) mislead creators.

Output ONLY this JSON shape, no other text, no markdown fences:
{"judgments":[{"topic":"<topic>","coverageStatus":"covered"|"partially_covered"|"not_covered","reasoning":"<one short sentence>"}, ...]}

Rules:
- One judgment per topic, in the same order as the input.
- Reasoning must be one sentence max.
- Do NOT include any topic you cannot judge — if uncertain, mark "partially_covered" with reasoning "uncertain based on title/description only."`.trim();

export async function detectContentGaps(
  clusters: ClusterSummary[],
  demandScores: DemandScore[],
  videoMetadata: VideoMetadata,
): Promise<ContentGap[]> {
  if (!Array.isArray(clusters) || clusters.length === 0) return [];
  if (!Array.isArray(demandScores) || demandScores.length === 0) return [];

  const demandByTopic = new Map<string, DemandScore>();
  for (const d of demandScores) demandByTopic.set(normalizeTopicKey(d.topic), d);

  const rankedClusters = [...clusters]
    .filter((c) => {
      const d = demandByTopic.get(normalizeTopicKey(c.topic));
      return d !== undefined && d.score > 0;
    })
    .sort((a, b) => {
      const da = demandByTopic.get(normalizeTopicKey(a.topic))!.score;
      const db = demandByTopic.get(normalizeTopicKey(b.topic))!.score;
      return db - da;
    })
    .slice(0, CONTENT_GAPS_TOP_N);

  if (rankedClusters.length === 0) return [];

  const titleForPrompt = (videoMetadata.title ?? '').trim() || '(no title)';
  const descForPrompt = (videoMetadata.description ?? '').trim() || '(no description)';

  const clusterInput = rankedClusters.map((c) => ({
    topic: c.topic,
    themeLabel: c.themeLabel,
    themeDescription: c.themeDescription,
    demandScore: demandByTopic.get(normalizeTopicKey(c.topic))!.score,
  }));

  const userPrompt = `Video title: ${titleForPrompt}\nVideo description: ${descForPrompt}\n\nTop ${clusterInput.length} audience-request clusters (sorted by demand score):\n${JSON.stringify(clusterInput)}`;

  let llmRaw: unknown;
  try {
    llmRaw = await chatJSON<unknown>(SYSTEM_PROMPT_GAP_DETECTION, userPrompt);
  } catch (err: any) {
    console.warn(
      `[contentGaps] detectContentGaps: LLM call failed (${err?.message ?? String(err)}); returning empty array.`,
    );
    return [];
  }

  if (!llmRaw || typeof llmRaw !== 'object' || !('judgments' in (llmRaw as any))) {
    console.warn(
      `[contentGaps] detectContentGaps: LLM returned unexpected shape; returning empty array.`,
    );
    return [];
  }
  const judgments = (llmRaw as any).judgments;
  if (!Array.isArray(judgments)) return [];

  const judgmentByTopic = new Map<string, { status: ContentGap['coverageStatus']; reasoning: string }>();
  for (const j of judgments) {
    if (!j || typeof j !== 'object') continue;
    const topic = normalizeTopicKey((j as any).topic);
    const status = (j as any).coverageStatus;
    const reasoning = typeof (j as any).reasoning === 'string' ? (j as any).reasoning.trim() : '';
    if (!topic) continue;
    if (status !== 'covered' && status !== 'partially_covered' && status !== 'not_covered') continue;
    judgmentByTopic.set(topic, { status, reasoning: reasoning || '(no reasoning provided)' });
  }

  const gaps: ContentGap[] = [];
  for (const c of rankedClusters) {
    const topicKey = normalizeTopicKey(c.topic);
    const j = judgmentByTopic.get(topicKey);
    if (!j) continue;
    if (j.status === 'covered') continue;
    gaps.push({
      topic: c.topic,
      demandScore: demandByTopic.get(topicKey)!.score,
      coverageStatus: j.status,
      reasoning: j.reasoning,
    });
  }

  gaps.sort((a, b) => b.demandScore - a.demandScore);
  return gaps;
}

export function findUnansweredQuestions(
  classified: ClassifiedComment[],
): UnansweredQuestion[] {
  if (!Array.isArray(classified) || classified.length === 0) return [];

  const questions = classified.filter((c) => c.intent === 'question');
  if (questions.length === 0) return [];

  const groups = groupByTopic(questions);
  const entries = Object.entries(groups)
    .map(([topic, comments]) => ({ topic, comments }))
    .sort((a, b) => b.comments.length - a.comments.length)
    .slice(0, UNANSWERED_QUESTIONS_TOP_N);

  return entries.map(({ topic, comments }) => ({
    topic,
    questionCount: comments.length,
    representativeQuestions: pickRepresentatives(comments),
  }));
}

export function detectEmergingTopics(
  classified: ClassifiedComment[],
  rawComments: ReadonlyArray<{ id: string; publishedAt: string }>,
): EmergingTopic[] {
  if (!Array.isArray(classified) || classified.length === 0) return [];
  if (!Array.isArray(rawComments) || rawComments.length === 0) return [];

  const publishedAtById = new Map<string, string>();
  for (const r of rawComments) {
    if (r && typeof r.id === 'string' && typeof r.publishedAt === 'string') {
      publishedAtById.set(r.id, r.publishedAt);
    }
  }

  const dated: Array<{ classified: ClassifiedComment; publishedAt: string }> = [];
  for (const c of classified) {
    const ts = publishedAtById.get(c.id);
    if (ts) dated.push({ classified: c, publishedAt: ts });
  }
  if (dated.length === 0) return [];

  dated.sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : a.publishedAt > b.publishedAt ? 1 : 0));

  const splitIndex = Math.floor(dated.length / 2);
  const earlyHalf = dated.slice(0, splitIndex);
  const lateHalf = dated.slice(splitIndex);

  if (earlyHalf.length === 0 || lateHalf.length === 0) return [];

  const earlyTotal = earlyHalf.length;
  const lateTotal = lateHalf.length;

  const earlyByTopic = new Map<string, number>();
  for (const { classified: c } of earlyHalf) {
    const k = normalizeTopicKey(c.topic);
    if (!k) continue;
    earlyByTopic.set(k, (earlyByTopic.get(k) ?? 0) + 1);
  }

  const lateByTopic = new Map<string, number>();
  for (const { classified: c } of lateHalf) {
    const k = normalizeTopicKey(c.topic);
    if (!k) continue;
    lateByTopic.set(k, (lateByTopic.get(k) ?? 0) + 1);
  }

  const allTopics = new Set<string>([...earlyByTopic.keys(), ...lateByTopic.keys()]);
  const results: EmergingTopic[] = [];

  for (const topic of allTopics) {
    const earlyCount = earlyByTopic.get(topic) ?? 0;
    const lateCount = lateByTopic.get(topic) ?? 0;

    if (lateCount < EMERGING_TOPICS_MIN_LATE_COUNT) continue;
    if (lateCount <= earlyCount) continue;

    const earlyShare = earlyCount / earlyTotal;
    const lateShare = lateCount / lateTotal;

    let growthRatio: number;
    if (earlyShare === 0) {
      growthRatio = lateShare * 1000;
    } else {
      growthRatio = lateShare / earlyShare;
    }

    if (growthRatio < EMERGING_TOPICS_MIN_GROWTH_RATIO) continue;

    results.push({
      topic,
      earlyCount,
      lateCount,
      growthRatio: Math.round(growthRatio * 100) / 100,
    });
  }

  results.sort((a, b) => {
    if (b.growthRatio !== a.growthRatio) return b.growthRatio - a.growthRatio;
    if (b.lateCount !== a.lateCount) return b.lateCount - a.lateCount;
    return a.topic.localeCompare(b.topic);
  });

  return results;
}
