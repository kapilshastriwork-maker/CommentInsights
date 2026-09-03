import { chatJSON as groqChatJSON } from '../groqClient';
import { chatJSON as nvidiaChatJSON } from '../nvidiaClient';
import type {
  ClassifiedComment,
  CommentIntent,
  Sentiment,
  Urgency,
} from './types';

const LLM_PROVIDER = (process.env.LLM_PROVIDER ?? 'groq').toLowerCase();
console.log(`[classifyComments] LLM_PROVIDER=${LLM_PROVIDER}`);
const chatJSON: typeof groqChatJSON =
  LLM_PROVIDER === 'groq' ? groqChatJSON : nvidiaChatJSON;

export const CLASSIFY_BATCH_SIZE = 6;
export const CLASSIFY_DEFAULT_CONCURRENCY = 1;
export const CLASSIFY_PROGRESS_TICK_BATCHES = 5;
export const CLASSIFY_INTER_BATCH_DELAY_MS = 500;

export const INTENT_VALUES: readonly CommentIntent[] = [
  'content_request',
  'question',
  'agree_validate',
  'share_experience',
  'disagree_debate',
  'confusion',
  'praise',
  'other',
] as const;

export const SENTIMENT_VALUES: readonly Sentiment[] = [
  'positive',
  'neutral',
  'negative',
] as const;

export const URGENCY_VALUES: readonly Urgency[] = [
  'low',
  'medium',
  'high',
] as const;

const VALID_INTENTS: ReadonlySet<CommentIntent> = new Set<CommentIntent>(
  INTENT_VALUES,
);
const VALID_SENTIMENTS: ReadonlySet<Sentiment> = new Set<Sentiment>(
  SENTIMENT_VALUES,
);
const VALID_URGENCIES: ReadonlySet<Urgency> = new Set<Urgency>(URGENCY_VALUES);

const SYSTEM_PROMPT = `Classify each YouTube comment. Return a single JSON object: {"results": [ ... ]}, one element per input, in the same order. Each element must include:
  id (string, exactly as input)
  text (string, echo original unchanged)
  intent (one of: "content_request" | "question" | "agree_validate" | "share_experience" | "disagree_debate" | "confusion" | "praise" | "other")
  topic (2-3 word lowercase phrase, e.g. "setup help", "video quality")
  subtopic (shorter, more specific lowercase phrase)
  sentiment ("positive" | "neutral" | "negative")
  urgency ("low" | "medium" | "high" — high if explicit request or stuck/confused, medium if a question, low if praise/agreement)
  explicit_request (boolean)

Output ONLY the JSON object. No markdown code fences, no text before/after, no trailing commas.

Input: [{"id":"ex1","text":"how do I set this up on windows?"}]
Output: {"results":[{"id":"ex1","text":"how do I set this up on windows?","intent":"question","topic":"setup help","subtopic":"windows install","sentiment":"neutral","urgency":"medium","explicit_request":false}]}

Input: [{"id":"ex2","text":"please make a part 2!!!"}]
Output: {"results":[{"id":"ex2","text":"please make a part 2!!!","intent":"content_request","topic":"sequel","subtopic":"part 2","sentiment":"positive","urgency":"high","explicit_request":true}]}

Input: [{"id":"ex3","text":"best explanation I've seen, thanks!"}]
Output: {"results":[{"id":"ex3","text":"best explanation I've seen, thanks!","intent":"praise","topic":"appreciation","subtopic":"quality","sentiment":"positive","urgency":"low","explicit_request":false}]}`.trim();

function fallbackOther(c: { id: string; text: string }): ClassifiedComment {
  return {
    id: c.id,
    text: c.text,
    intent: 'other',
    topic: 'unknown',
    subtopic: 'unknown',
    sentiment: 'neutral',
    urgency: 'low',
    explicit_request: false,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateAndNormalize(
  raw: unknown,
  inputs: { id: string; text: string }[],
): { ok: true; value: ClassifiedComment[] } | { ok: false; reason: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'response is not a JSON object' };
  }
  const results = (raw as any).results;
  if (!Array.isArray(results)) {
    return {
      ok: false,
      reason: `response.results is not an array (got ${typeof results})`,
    };
  }
  if (results.length !== inputs.length) {
    return {
      ok: false,
      reason: `length mismatch: got ${results.length}, expected ${inputs.length}`,
    };
  }
  const inputIds = new Set(inputs.map((i) => i.id));
  const seenIds = new Set<string>();
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    if (!isPlainObject(r)) {
      return { ok: false, reason: `row ${i} is not an object` };
    }
    if (typeof r.id !== 'string' || !inputIds.has(r.id)) {
      return {
        ok: false,
        reason: `row ${i} has invalid id: ${JSON.stringify(r.id)}`,
      };
    }
    if (seenIds.has(r.id)) {
      return { ok: false, reason: `duplicate id: ${r.id}` };
    }
    seenIds.add(r.id);
  }
  if (seenIds.size !== inputs.length) {
    return {
      ok: false,
      reason: `id set size ${seenIds.size} != input length ${inputs.length}`,
    };
  }

  const byId = new Map<string, { id: string; text: string }>(
    inputs.map((i) => [i.id, i]),
  );

  const out: ClassifiedComment[] = results.map((r: any) => {
    const original = byId.get(r.id)!;
    const intent: CommentIntent = VALID_INTENTS.has(r.intent)
      ? r.intent
      : 'other';
    const sentiment: Sentiment = VALID_SENTIMENTS.has(r.sentiment)
      ? r.sentiment
      : 'neutral';
    const urgency: Urgency = VALID_URGENCIES.has(r.urgency) ? r.urgency : 'low';
    const topic = typeof r.topic === 'string' && r.topic.trim() ? r.topic : 'unknown';
    const subtopic =
      typeof r.subtopic === 'string' && r.subtopic.trim() ? r.subtopic : 'unknown';
    const explicit_request =
      typeof r.explicit_request === 'boolean' ? r.explicit_request : false;
    return {
      id: original.id,
      text: original.text,
      intent,
      topic,
      subtopic,
      sentiment,
      urgency,
      explicit_request,
    };
  });

  return { ok: true, value: out };
}

export async function classifyBatch(
  comments: { id: string; text: string }[],
): Promise<ClassifiedComment[]> {
  if (!Array.isArray(comments)) {
    throw new Error('classifyBatch: comments must be an array.');
  }
  if (comments.length === 0) return [];
  if (comments.length > CLASSIFY_BATCH_SIZE) {
    throw new Error(
      `classifyBatch: batch size ${comments.length} exceeds CLASSIFY_BATCH_SIZE (${CLASSIFY_BATCH_SIZE}). ` +
        'Chunk your input before calling.',
    );
  }

  const inputs = comments.map((c) => ({
    id: String(c.id),
    text: String(c.text ?? ''),
  }));

  const userPrompt = `Classify the following ${inputs.length} YouTube comment(s):\n${JSON.stringify(inputs)}`;

  let firstErr: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let raw: unknown;
    try {
      raw = await chatJSON<unknown>(SYSTEM_PROMPT, userPrompt);
    } catch (err: any) {
      firstErr = `chatJSON threw: ${err?.message ?? String(err)}`;
      console.warn(`[classifyBatch] attempt ${attempt} failed: ${firstErr}`);
      continue;
    }
    const v = validateAndNormalize(raw, inputs);
    if (v.ok) {
      return v.value;
    }
    firstErr = v.reason;
    console.warn(`[classifyBatch] attempt ${attempt} validation failed: ${v.reason}`);
  }

  console.warn(
    `[classifyBatch] both attempts failed (${firstErr ?? 'unknown'}); ` +
      `falling back to intent="other" for ${inputs.length} comment(s).`,
  );
  return inputs.map(fallbackOther);
}

export interface ClassifyAllOptions {
  concurrency?: number;
  onProgress?: (doneBatches: number, totalBatches: number, doneComments: number, totalComments: number) => void;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function classifyAllComments(
  comments: { id: string; text: string }[],
  opts: ClassifyAllOptions = {},
): Promise<ClassifiedComment[]> {
  if (!Array.isArray(comments)) {
    throw new Error('classifyAllComments: comments must be an array.');
  }
  if (comments.length === 0) return [];

  const inputs = comments.map((c) => ({
    id: String(c.id),
    text: String(c.text ?? ''),
  }));

  const batches = chunk(inputs, CLASSIFY_BATCH_SIZE);
  const totalBatches = batches.length;
  const totalComments = inputs.length;
  const concurrency = Math.max(
    1,
    Math.min(opts.concurrency ?? CLASSIFY_DEFAULT_CONCURRENCY, totalBatches),
  );

  const results: ClassifiedComment[][] = new Array(totalBatches);
  const t0 = Date.now();

  let nextBatch = 0;
  let completedBatches = 0;
  let completedComments = 0;
  let retriedOrFailedBatches = 0;

  const runOne = async (batchIndex: number): Promise<void> => {
    const batch = batches[batchIndex];
    let result: ClassifiedComment[];
    try {
      result = await classifyBatch(batch);
    } catch (err: any) {
      retriedOrFailedBatches += 1;
      console.warn(
        `[classifyAllComments] batch ${batchIndex + 1}/${totalBatches} threw: ${err?.message ?? String(err)}. ` +
          `Filling with intent="other" fallback.`,
      );
      result = batch.map(fallbackOther);
    }
    results[batchIndex] = result;
    completedBatches += 1;
    completedComments += result.length;
    if (
      completedBatches % CLASSIFY_PROGRESS_TICK_BATCHES === 0 ||
      completedBatches === totalBatches
    ) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `[classifyAllComments] Classified ${completedComments}/${totalComments} comments ` +
          `(${completedBatches}/${totalBatches} batches) in ${elapsed}s`,
      );
    }
    if (opts.onProgress) {
      try {
        opts.onProgress(completedBatches, totalBatches, completedComments, totalComments);
      } catch {
        // never let a bad progress callback kill the run
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i += 1) {
    const worker = (async () => {
      while (true) {
        const myIdx = nextBatch;
        nextBatch += 1;
        if (myIdx >= totalBatches) return;
        await runOne(myIdx);
        if (nextBatch < totalBatches && CLASSIFY_INTER_BATCH_DELAY_MS > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, CLASSIFY_INTER_BATCH_DELAY_MS),
          );
        }
      }
    })();
    workers.push(worker);
  }

  await Promise.all(workers);

  const combined = results.flat();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[classifyAllComments] done: ${combined.length}/${totalComments} comments ` +
      `in ${elapsed}s (${retriedOrFailedBatches} batch(es) hit hard failure, used fallback)`,
  );
  return combined;
}
