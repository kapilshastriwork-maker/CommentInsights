import { chatJSON as groqChatJSON } from '../groqClient';
import { chatJSON as nvidiaChatJSON } from '../nvidiaClient';
import type {
  ClassifiedComment,
  ClusterSummary,
  CommentIntent,
  ExtractThemesResult,
  RequestBreakdown,
  Sentiment,
  TailCluster,
  Urgency,
} from './types';

const LLM_PROVIDER = (process.env.LLM_PROVIDER ?? 'groq').toLowerCase();
console.log(`[clusterComments] LLM_PROVIDER=${LLM_PROVIDER}`);
const chatJSON: typeof groqChatJSON =
  LLM_PROVIDER === 'groq' ? groqChatJSON : nvidiaChatJSON;

export const CLUSTER_MIN_GROUP_SIZE = 3;
export const CLUSTER_DEFAULT_CONCURRENCY = 1;
export const CLUSTER_REPRESENTATIVE_COUNT = 5;
export const CLUSTER_TAIL_SAMPLE_COUNT = 2;
export const CLUSTER_LLM_FANOUT_CONCURRENCY = 1;

const URGENCY_WEIGHT: Record<Urgency, number> = { low: 1, medium: 2, high: 3 };
const REQUEST_BREAKDOWN_ELIGIBLE_INTENTS: ReadonlySet<CommentIntent> = new Set([
  'content_request',
  'question',
]);
const INTENT_ENUM_ORDER: readonly CommentIntent[] = [
  'content_request',
  'question',
  'agree_validate',
  'share_experience',
  'disagree_debate',
  'confusion',
  'praise',
  'other',
];
const SENTIMENT_ENUM_ORDER: readonly Sentiment[] = [
  'positive',
  'neutral',
  'negative',
];

function normalizeTopicKey(t: string): string {
  return (t ?? '').trim().toLowerCase();
}

export function groupByTopic(
  classified: ClassifiedComment[],
): Record<string, ClassifiedComment[]> {
  const map = new Map<string, ClassifiedComment[]>();
  for (const c of classified) {
    const key = normalizeTopicKey(c.topic);
    if (!key) continue;
    const bucket = map.get(key);
    if (bucket) bucket.push(c);
    else map.set(key, [c]);
  }
  const out: Record<string, ClassifiedComment[]> = {};
  for (const [k, v] of map.entries()) out[k] = v;
  const sizesDesc = Object.entries(out)
    .map(([k, v]) => [k, v.length] as const)
    .sort((a, b) => b[1] - a[1]);
  const top = sizesDesc.slice(0, 10).map(([k, n]) => `${n}x ${k}`);
  console.log(
    `[clusterComments] groupByTopic: ${sizesDesc.length} distinct topics from ${classified.length} comments. Top sizes: [${top.join(', ')}]`,
  );
  return out;
}

export function pickRepresentatives(
  comments: ClassifiedComment[],
  max: number = CLUSTER_REPRESENTATIVE_COUNT,
): string[] {
  if (comments.length === 0) return [];
  const scored = comments.map((c) => ({
    text: String(c.text ?? ''),
    score:
      URGENCY_WEIGHT[c.urgency] * 1000 +
      (c.explicit_request ? 500 : 0) +
      String(c.text ?? '').length,
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.text.length - a.text.length;
  });
  const targetCount = Math.min(Math.max(max, 1), scored.length);
  return scored.slice(0, targetCount).map((s) => s.text);
}

function tallyIntents(rows: ClassifiedComment[]): Record<CommentIntent, number> {
  const out = {} as Record<CommentIntent, number>;
  for (const i of INTENT_ENUM_ORDER) out[i] = 0;
  for (const r of rows) out[r.intent] = (out[r.intent] ?? 0) + 1;
  return out;
}

function tallySentiments(rows: ClassifiedComment[]): Record<Sentiment, number> {
  const out = {} as Record<Sentiment, number>;
  for (const s of SENTIMENT_ENUM_ORDER) out[s] = 0;
  for (const r of rows) out[r.sentiment] = (out[r.sentiment] ?? 0) + 1;
  return out;
}

function tallyUrgencies(rows: ClassifiedComment[]): Record<Urgency, number> {
  const out = {} as Record<Urgency, number>;
  for (const u of Object.keys(URGENCY_WEIGHT) as Urgency[]) out[u] = 0;
  for (const r of rows) out[r.urgency] = (out[r.urgency] ?? 0) + 1;
  return out;
}

function argmaxWithEnumOrder<T extends string>(
  counts: Record<T, number>,
  order: readonly T[],
): T {
  let best: T | null = null;
  let bestCount = -1;
  for (const k of order) {
    const n = counts[k] ?? 0;
    if (n > bestCount) {
      bestCount = n;
      best = k;
    }
  }
  return (best ?? order[0]) as T;
}

function averageUrgencyNumeric(rows: ClassifiedComment[]): number {
  if (rows.length === 0) return 0;
  let sum = 0;
  for (const r of rows) sum += URGENCY_WEIGHT[r.urgency];
  return Math.round((sum / rows.length) * 100) / 100;
}

const CHICAGO_SMALL_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of',
  'on', 'or', 'so', 'the', 'to', 'up', 'yet', 'with', 'from',
]);

function toChicagoTitleCase(input: string): string {
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  return words
    .map((w, idx) => {
      const lower = w.toLowerCase();
      const isFirst = idx === 0;
      const isLast = idx === words.length - 1;
      if (!isFirst && !isLast && CHICAGO_SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function fallbackThemeLabel(topic: string): string {
  const words = topic.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.length === 0) return 'Uncategorized';
  return toChicagoTitleCase(words.join(' '));
}

function validateThemeLabel(raw: unknown, topicFallback: string): string {
  if (typeof raw !== 'string') return fallbackThemeLabel(topicFallback);
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return fallbackThemeLabel(topicFallback);
  if (words.length < 2 || words.length > 5) {
    return fallbackThemeLabel(topicFallback);
  }
  return toChicagoTitleCase(raw.trim());
}

function validateThemeDescription(raw: unknown, topic: string, size: number): string {
  if (typeof raw !== 'string') {
    return `Cluster of ${size} comments about ${topic}.`;
  }
  const trimmed = raw.trim();
  if (!trimmed) return `Cluster of ${size} comments about ${topic}.`;
  if (trimmed.length > 500) return trimmed.slice(0, 497) + '...';
  return trimmed;
}

const SYSTEM_PROMPT = `You cluster YouTube comments by topic. Given a list of comments all about the same topic, return a single JSON object: {"themeLabel": "<2-5 word label>", "themeDescription": "<1-2 sentence summary>"}. Do NOT pick representative comments — code will do that. Do NOT include any other fields, commentary, or markdown fences. Output ONLY the JSON object.

Input comments (N total): [{"id":"c1","text":"..."}, {"id":"c2","text":"..."}, ...]
Output: {"themeLabel":"...","themeDescription":"..."}

Input: [{"id":"ex1","text":"can confirm: he never gave us up"}, {"id":"ex2","text":"never gonna let you down"}, {"id":"ex3","text":"best song ever, classic"}]
Output: {"themeLabel":"rickroll nostalgia","themeDescription":"Viewers sharing positive reactions and memories about a classic Rick Astley song."}

Input: [{"id":"ex4","text":"please make a part 2!!!"}, {"id":"ex5","text":"bro upload the sequel"}, {"id":"ex6","text":"need part 3 asap"}]
Output: {"themeLabel":"sequel requests","themeDescription":"Viewers explicitly asking for a follow-up video or continuation of the series."}`.trim();

const SYSTEM_PROMPT_BREAKDOWN = `You are an analyst of YouTube audience feedback. Given a cluster of related YouTube comments, identify 3-6 distinct REQUEST CATEGORIES (specific things audiences are asking for in this cluster) and count how many comments map to each. A comment might fit 0, 1, or multiple categories — count it in the most relevant one.

Output ONLY this JSON shape, no other text, no markdown fences:
{"breakdown":[{"label":"<2-5 word category>","count":<integer>},{"label":"...","count":<integer>}, ...]}

Rules:
- Labels must be specific (e.g. "step-by-step tutorial", "beginner explanation", "tool recommendations", "course schedule questions", "career-switching advice") — NOT generic ("questions", "feedback", "general").
- Counts should be positive integers.
- 3-6 labels. If a cluster has very few distinct asks, return 3. If many, return up to 6.
- Comments are in mixed languages (English + Hindi). Read both.`.trim();

export async function summarizeCluster(
  topic: string,
  comments: ClassifiedComment[],
): Promise<ClusterSummary> {
  if (comments.length < CLUSTER_MIN_GROUP_SIZE) {
    console.warn(
      `[clusterComments] summarizeCluster called with ${comments.length} comments (< MIN=${CLUSTER_MIN_GROUP_SIZE}); returning code-side summary without LLM call.`,
    );
  }

  const isUnknownTopic = normalizeTopicKey(topic) === 'unknown';
  const representatives = pickRepresentatives(comments);
  const intentBreakdown = tallyIntents(comments);
  const sentimentBreakdown = tallySentiments(comments);
  const urgencyBreakdown = tallyUrgencies(comments);
  const dominantIntent = argmaxWithEnumOrder(intentBreakdown, INTENT_ENUM_ORDER);
  const dominantSentiment = argmaxWithEnumOrder(
    sentimentBreakdown,
    SENTIMENT_ENUM_ORDER,
  );
  const averageUrg = averageUrgencyNumeric(comments);
  const explicitRequestCount = comments.filter((c) => c.explicit_request).length;

  let themeLabel: string;
  let themeDescription: string;

  if (isUnknownTopic) {
    themeLabel = 'Uncategorized';
    themeDescription =
      'Comments where the classification model could not determine a specific topic. May include low-context remarks, very short replies, or off-topic chatter.';
  } else {
    const userPayload = comments.map((c) => ({
      id: c.id,
      text: String(c.text ?? ''),
    }));
    const userPrompt = `Cluster these ${comments.length} comments (all about topic "${topic}"):\n${JSON.stringify(userPayload)}`;
    try {
      const llmRaw = await chatJSON<unknown>(SYSTEM_PROMPT, userPrompt);
      if (
        llmRaw &&
        typeof llmRaw === 'object' &&
        'themeLabel' in (llmRaw as any) &&
        'themeDescription' in (llmRaw as any)
      ) {
        themeLabel = validateThemeLabel(
          (llmRaw as any).themeLabel,
          topic,
        );
        themeDescription = validateThemeDescription(
          (llmRaw as any).themeDescription,
          topic,
          comments.length,
        );
      } else {
        console.warn(
          `[clusterComments] summarizeCluster: LLM returned unexpected shape for topic="${topic}"; using fallback label/description.`,
        );
        themeLabel = fallbackThemeLabel(topic);
        themeDescription = `Cluster of ${comments.length} comments about ${topic}.`;
      }
    } catch (err: any) {
      console.warn(
        `[clusterComments] summarizeCluster: LLM call failed for topic="${topic}" (${err?.message ?? String(err)}); using fallback label/description.`,
      );
      themeLabel = fallbackThemeLabel(topic);
      themeDescription = `Cluster of ${comments.length} comments about ${topic}. (LLM summarization failed; this is a code-side placeholder.)`;
    }
  }

  const requestBreakdown = await breakdownClusterRequests({
    dominantIntent,
    comments,
  });

  return {
    topic,
    size: comments.length,
    representativeComments: representatives,
    intentBreakdown,
    sentimentBreakdown,
    urgencyBreakdown,
    dominantIntent,
    dominantSentiment,
    averageUrgency: averageUrg,
    themeLabel,
    themeDescription,
    explicitRequestCount,
    isUnknownTopic,
    requestBreakdown,
  };
}

function isValidBreakdownLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return null;
  return toChicagoTitleCase(raw.trim());
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 && Math.floor(n) === n;
}

export async function breakdownClusterRequests(args: {
  dominantIntent: CommentIntent;
  comments: ClassifiedComment[];
}): Promise<RequestBreakdown[] | null> {
  const { dominantIntent, comments } = args;
  if (!REQUEST_BREAKDOWN_ELIGIBLE_INTENTS.has(dominantIntent)) {
    return null;
  }
  if (!Array.isArray(comments) || comments.length === 0) {
    return null;
  }

  const userPayload = comments.map((c) => ({
    id: c.id,
    text: String(c.text ?? ''),
    subtopic: String(c.subtopic ?? ''),
  }));
  const userPrompt = `Cluster theme: "${dominantIntent}"\nComment count: ${comments.length}\nComments (id, text, subtopic):\n${JSON.stringify(userPayload)}`;

  let llmRaw: unknown;
  try {
    llmRaw = await chatJSON<unknown>(SYSTEM_PROMPT_BREAKDOWN, userPrompt);
  } catch (err: any) {
    console.warn(
      `[clusterComments] breakdownClusterRequests: LLM call failed for dominantIntent="${dominantIntent}" (${err?.message ?? String(err)}); returning null.`,
    );
    return null;
  }

  if (!llmRaw || typeof llmRaw !== 'object' || !('breakdown' in (llmRaw as any))) {
    console.warn(
      `[clusterComments] breakdownClusterRequests: LLM returned unexpected shape; returning null.`,
    );
    return null;
  }
  const rows = (llmRaw as any).breakdown;
  if (!Array.isArray(rows)) return null;

  const validated: RequestBreakdown[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const label = isValidBreakdownLabel((row as any).label);
    const count = isPositiveInt((row as any).count) ? (row as any).count : null;
    if (label && count !== null) validated.push({ label, count });
  }

  if (validated.length < 3) {
    console.warn(
      `[clusterComments] breakdownClusterRequests: only ${validated.length} valid rows after validation (need >=3); returning null.`,
    );
    return null;
  }
  const clamped = validated.slice(0, 6).sort((a, b) => b.count - a.count);

  const sumCounts = clamped.reduce((acc, r) => acc + r.count, 0);
  if (sumCounts === 0 || sumCounts > 2 * comments.length) {
    console.warn(
      `[clusterComments] breakdownClusterRequests: sanity check failed (sumCounts=${sumCounts}, comments.length=${comments.length}); returning null.`,
    );
    return null;
  }

  return clamped;
}

function buildTailEntry(
  topic: string,
  comments: ClassifiedComment[],
): TailCluster {
  return {
    topic,
    size: comments.length,
    sampleCommentTexts: pickRepresentatives(comments, CLUSTER_TAIL_SAMPLE_COUNT),
    isUnknownTopic: normalizeTopicKey(topic) === 'unknown',
  };
}

export async function clusterAllComments(
  classified: ClassifiedComment[],
): Promise<ExtractThemesResult> {
  if (!Array.isArray(classified) || classified.length === 0) {
    return { summarized: [], tail: [] };
  }
  const groups = groupByTopic(classified);
  const entries = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

  const summarizable: Array<{ topic: string; comments: ClassifiedComment[] }> = [];
  const tailEntries: Array<{ topic: string; comments: ClassifiedComment[] }> = [];
  for (const [topic, comments] of entries) {
    if (comments.length >= CLUSTER_MIN_GROUP_SIZE) {
      summarizable.push({ topic, comments });
    } else {
      tailEntries.push({ topic, comments });
    }
  }

  console.log(
    `[clusterComments] clusterAllComments: ${summarizable.length} summarizable clusters, ${tailEntries.length} tail clusters`,
  );

  const summarizedResults: ClusterSummary[] = new Array(summarizable.length);
  let nextIdx = 0;
  const t0 = Date.now();

  const worker = async (): Promise<void> => {
    while (true) {
      const myIdx = nextIdx;
      nextIdx += 1;
      if (myIdx >= summarizable.length) return;
      const { topic, comments } = summarizable[myIdx];
      try {
        summarizedResults[myIdx] = await summarizeCluster(topic, comments);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const breakdownTag = summarizedResults[myIdx].requestBreakdown === null
          ? '(breakdown: skipped/null)'
          : `(breakdown: ${summarizedResults[myIdx].requestBreakdown!.length} labels)`;
        console.log(
          `[clusterComments] summarized ${myIdx + 1}/${summarizable.length}: topic="${topic}" size=${comments.length} in ${elapsed}s cumulative ${breakdownTag}`,
        );
      } catch (err: any) {
        console.warn(
          `[clusterComments] summarizeCluster threw for topic="${topic}" (${err?.message ?? String(err)}); using code-side fallback summary.`,
        );
        summarizedResults[myIdx] = await summarizeCluster(topic, comments);
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < CLUSTER_LLM_FANOUT_CONCURRENCY; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  const tail: TailCluster[] = tailEntries.map((t) =>
    buildTailEntry(t.topic, t.comments),
  );
  const tailSorted = tail.sort((a, b) => b.size - a.size);

  console.log(
    `[clusterComments] clusterAllComments: done. ${summarizedResults.length} summaries, ${tailSorted.length} tail clusters in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  return { summarized: summarizedResults, tail: tailSorted };
}

export const extractThemes = clusterAllComments;
