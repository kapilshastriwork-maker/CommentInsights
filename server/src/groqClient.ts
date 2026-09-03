import Groq from 'groq-sdk';

export const DEFAULT_GROQ_MODEL =
  process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b';

export const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY ?? '',
  maxRetries: 0,
  timeout: 30_000,
});

export class GroqJsonError extends Error {
  rawText: string;
  cause?: unknown;
  constructor(message: string, rawText: string, cause?: unknown) {
    super(message);
    this.name = 'GroqJsonError';
    this.rawText = rawText;
    this.cause = cause;
  }
}

export function assertGroqConfigured(): void {
  const key = process.env.GROQ_API_KEY;
  if (!key || !key.trim()) {
    throw new Error(
      'GROQ_API_KEY is not set. Add it to server/.env (see .env.example).',
    );
  }
}

const JSON_REMINDER =
  'Your last response was not valid JSON. Return ONLY a JSON object. ' +
  'No markdown fences, no commentary, no explanation.';

const RATE_LIMIT_DEFAULT_WAIT_MS = 5_000;
const RATE_LIMIT_BUFFER_MS = 1_000;

const REASONING_MODEL_PREFIXES = ['qwen/'];

function shouldSendReasoningFormat(model: string): boolean {
  return REASONING_MODEL_PREFIXES.some((p) => model.startsWith(p));
}

function extractContent(completion: any): string {
  const choice = completion?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new GroqJsonError(
      'Groq response had no message content.',
      typeof content === 'string' ? content : '',
    );
  }
  return content;
}

// No-op for non-reasoning models (e.g. openai/gpt-oss-120b). Defensive against
// future model swaps to a reasoning model that ignores reasoning_format=hidden.
function stripThinkingBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim();
}

function stripCodeFences(text: string): string {
  let s = text.trim();
  s = s.replace(/^\s*```(?:json)?\s*\n?/i, '');
  s = s.replace(/\n?\s*```\s*$/i, '');
  return s.trim();
}

function parseOrLog<T>(text: string, attemptLabel: string): T {
  const noThinking = stripThinkingBlocks(text);
  const cleaned = stripCodeFences(noThinking);
  try {
    return JSON.parse(cleaned) as T;
  } catch (cause) {
    console.error(
      `[chatJSON] ${attemptLabel} FAILED to parse. ` +
        `Raw response (length=${text.length}, full text below):\n` +
        `---\n${text}\n---\n` +
        `After stripping thinking blocks: removed ${text.length - noThinking.length} chars (length=${noThinking.length})\n` +
        `---\n${noThinking}\n---\n` +
        `After stripping code fences: removed ${noThinking.length - cleaned.length} chars (length=${cleaned.length})\n` +
        `---\n${cleaned}\n---\n` +
        `JSON.parse error: ${(cause as Error).message}`,
    );
    throw cause;
  }
}

function isRateLimitError(err: any): boolean {
  if (!err) return false;
  const status = err?.status ?? err?.response?.status;
  if (status === 429) return true;
  const code = err?.code;
  if (code === 'rate_limit_exceeded') return true;
  const msg = String(err?.message ?? '');
  if (/429/.test(msg) && /rate limit/i.test(msg)) return true;
  return false;
}

function parseRateLimitWaitMs(err: any): number {
  const msg = String(err?.message ?? '');
  const match = msg.match(/try again in\s+([\d.]+)\s*s/i);
  if (match) {
    const seconds = parseFloat(match[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.round(seconds * 1000);
    }
  }
  return RATE_LIMIT_DEFAULT_WAIT_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CompletionRequestArgs {
  model: string;
  messages: any[];
  reasoningFormat?: 'hidden' | 'parsed' | 'raw';
}

function logGroqError(context: string, err: any): void {
  const body = {
    status: err?.status,
    code: err?.error?.code,
    type: err?.error?.type,
    message: err?.message,
    failed_generation:
      typeof err?.error?.failed_generation === 'string'
        ? err.error.failed_generation.slice(0, 500)
        : err?.error?.failed_generation,
  };
  console.error(`[groqClient] ${context}:`, JSON.stringify(body, null, 2));
}

async function callGroqOnce({ model, messages, reasoningFormat }: CompletionRequestArgs): Promise<any> {
  const reasoningSent = !!(reasoningFormat && shouldSendReasoningFormat(model));
  console.log(
    `[groqClient] request: model=${model}, reasoning_format=${reasoningSent ? reasoningFormat : '(suppressed)'}, temperature=0.2`,
  );
  const body: any = {
    model,
    temperature: 0.2,
    messages,
  };
  if (reasoningSent) body.reasoning_format = reasoningFormat;
  try {
    return await groq.chat.completions.create(body);
  } catch (err: any) {
    if (isRateLimitError(err)) {
      throw err;
    }
    logGroqError('callGroqOnce non-rate-limit error', err);
    throw err;
  }
}

export async function chatJSON<T = unknown>(
  systemPrompt: string,
  userPrompt: string,
  model: string = DEFAULT_GROQ_MODEL,
): Promise<T> {
  assertGroqConfigured();

  const baseMessages: any[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let firstCompletion: any;
  try {
    firstCompletion = await callGroqOnce({ model, messages: baseMessages, reasoningFormat: 'hidden' });
  } catch (err: any) {
    if (isRateLimitError(err)) {
      const waitMs = parseRateLimitWaitMs(err) + RATE_LIMIT_BUFFER_MS;
      console.warn(
        `[chatJSON] Rate limited, waiting ${(waitMs / 1000).toFixed(1)}s before retry`,
      );
      await sleep(waitMs);
      try {
        firstCompletion = await callGroqOnce({ model, messages: baseMessages, reasoningFormat: 'hidden' });
      } catch (err2: any) {
        logGroqError('callGroqOnce failed after rate-limit retry', err2);
        const fg = err2?.error?.failed_generation;
        const fgSuffix =
          typeof fg === 'string' && fg
            ? ` | failed_generation (first 500 chars): ${fg.slice(0, 500)}`
            : '';
        throw new Error(
          `Groq chat.completions failed after rate-limit retry: ${err2?.message ?? String(err2)}${fgSuffix}`,
        );
      }
    } else {
      throw err;
    }
  }

  const firstText = extractContent(firstCompletion);
  try {
    return parseOrLog<T>(firstText, 'attempt 1');
  } catch {
    console.warn(
      `[chatJSON] first response was not valid JSON; retrying once. Raw (truncated): ${firstText.slice(0, 200)}`,
    );
  }

  const retryMessages: any[] = [
    ...baseMessages,
    { role: 'assistant', content: firstText },
    { role: 'system', content: JSON_REMINDER },
  ];

  let retryCompletion: any;
  try {
    retryCompletion = await callGroqOnce({ model, messages: retryMessages, reasoningFormat: 'hidden' });
  } catch (err: any) {
    if (isRateLimitError(err)) {
      const waitMs = parseRateLimitWaitMs(err) + RATE_LIMIT_BUFFER_MS;
      console.warn(
        `[chatJSON] Rate limited on JSON-retry, waiting ${(waitMs / 1000).toFixed(1)}s before retry`,
      );
      await sleep(waitMs);
      try {
        retryCompletion = await callGroqOnce({ model, messages: retryMessages, reasoningFormat: 'hidden' });
      } catch (err2: any) {
        logGroqError('callGroqOnce failed on JSON-retry after rate-limit retry', err2);
        const fg = err2?.error?.failed_generation;
        const fgSuffix =
          typeof fg === 'string' && fg
            ? ` | failed_generation (first 500 chars): ${fg.slice(0, 500)}`
            : '';
        throw new Error(
          `Groq chat.completions JSON-retry failed after rate-limit retry: ${err2?.message ?? String(err2)}${fgSuffix}`,
        );
      }
    } else {
      throw err;
    }
  }

  const retryText = extractContent(retryCompletion);
  return parseOrLog<T>(retryText, 'attempt 2 (JSON-retry)');
}
