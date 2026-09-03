import OpenAI from 'openai';

export const DEFAULT_NVIDIA_MODEL =
  process.env.NVIDIA_MODEL?.trim() || 'openai/gpt-oss-120b';

export const nvidia = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY ?? '',
  baseURL: 'https://integrate.api.nvidia.com/v1',
  maxRetries: 0,
  timeout: 30_000,
});

export class NvidiaJsonError extends Error {
  rawText: string;
  cause?: unknown;
  constructor(message: string, rawText: string, cause?: unknown) {
    super(message);
    this.name = 'NvidiaJsonError';
    this.rawText = rawText;
    this.cause = cause;
  }
}

export function assertNvidiaConfigured(): void {
  const key = process.env.NVIDIA_API_KEY;
  if (!key || !key.trim() || key === 'nvapi-...') {
    throw new Error(
      'NVIDIA_API_KEY is not set. Add it to server/.env (see .env.example).',
    );
  }
}

const JSON_REMINDER =
  'Your last response was not valid JSON. Return ONLY a JSON object. ' +
  'No markdown fences, no commentary, no explanation.';

const RATE_LIMIT_DEFAULT_WAIT_MS = 5_000;
const RATE_LIMIT_BUFFER_MS = 1_000;

const REASONING_MODEL_PREFIXES = ['qwen/', 'kimi-k2-thinking'];

function shouldSendReasoningFormat(model: string): boolean {
  return REASONING_MODEL_PREFIXES.some((p) => model.startsWith(p));
}

function extractContent(completion: any): string {
  const choice = completion?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new NvidiaJsonError(
      'NVIDIA NIM response had no message content.',
      typeof content === 'string' ? content : '',
    );
  }
  return content;
}

// No-op for non-reasoning models (e.g. openai/gpt-oss-120b). Defensive against
// future model swaps to a reasoning model.
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
      `[nvidiaClient chatJSON] ${attemptLabel} FAILED to parse. ` +
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

let loggedFirstRateLimitBody = false;
let loggedFirstNonRateLimitBody = false;

function logNvidiaError(context: string, err: any): void {
  const body = {
    status: err?.status ?? err?.response?.status,
    headers: err?.headers ?? err?.response?.headers,
    code: err?.error?.code,
    type: err?.error?.type,
    param: err?.error?.param,
    message: err?.message,
    error: err?.error,
    rawResponseBody: err?.response?.data ?? err?.response?.body ?? err?.errorResponseBody,
  };
  console.error(`[nvidiaClient] ${context}:`, JSON.stringify(body, null, 2));
}

function isRateLimitError(err: any): boolean {
  if (!err) return false;
  const status = err?.status ?? err?.response?.status;
  if (status === 429) return true;
  const code = err?.error?.code;
  if (code === 'rate_limit_exceeded' || code === 429) return true;
  const type = err?.error?.type;
  if (type === 'requests' || type === 'tokens') return true;
  const msg = String(err?.message ?? '');
  if (/429/.test(msg) && /rate limit/i.test(msg)) return true;
  return false;
}

function parseRateLimitWaitMs(err: any): number {
  const headers = err?.headers ?? err?.response?.headers;
  if (headers) {
    const retryAfter = headers['retry-after'] ?? headers['Retry-After'];
    if (retryAfter != null) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.round(seconds * 1000);
      }
    }
  }
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

async function callNvidiaOnce({ model, messages, reasoningFormat }: CompletionRequestArgs): Promise<any> {
  const reasoningSent = !!(reasoningFormat && shouldSendReasoningFormat(model));
  console.log(
    `[nvidiaClient] request: model=${model}, reasoning_format=${reasoningSent ? reasoningFormat : '(suppressed)'}, temperature=0.2`,
  );
  const body: any = {
    model,
    temperature: 0.2,
    messages,
  };
  if (reasoningSent) body.reasoning_format = reasoningFormat;
  try {
    return await nvidia.chat.completions.create(body);
  } catch (err: any) {
    if (isRateLimitError(err)) {
      if (!loggedFirstRateLimitBody) {
        loggedFirstRateLimitBody = true;
        console.warn(
          '[nvidiaClient] First 429 encountered — dumping full error body to learn the actual shape:',
        );
        logNvidiaError('first rate-limit error', err);
      }
      throw err;
    }
    logNvidiaError('callNvidiaOnce non-rate-limit error', err);
    if (!loggedFirstNonRateLimitBody) {
      loggedFirstNonRateLimitBody = true;
      console.warn(
        '[nvidiaClient] First non-rate-limit error — dumping raw response body for diagnosis:',
      );
      try {
        const raw = err?.response?.data ?? err?.response?.body ?? err?.error?.message ?? err?.message;
        console.warn('[nvidiaClient] raw body:', typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2));
      } catch {
        console.warn('[nvidiaClient] (could not extract raw body)');
      }
    }
    throw err;
  }
}

export async function chatJSON<T = unknown>(
  systemPrompt: string,
  userPrompt: string,
  model: string = DEFAULT_NVIDIA_MODEL,
): Promise<T> {
  assertNvidiaConfigured();

  const baseMessages: any[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let firstCompletion: any;
  try {
    firstCompletion = await callNvidiaOnce({ model, messages: baseMessages, reasoningFormat: 'hidden' });
  } catch (err: any) {
    if (isRateLimitError(err)) {
      const waitMs = parseRateLimitWaitMs(err) + RATE_LIMIT_BUFFER_MS;
      console.warn(
        `[nvidiaClient chatJSON] Rate limited, waiting ${(waitMs / 1000).toFixed(1)}s before retry`,
      );
      await sleep(waitMs);
      try {
        firstCompletion = await callNvidiaOnce({ model, messages: baseMessages, reasoningFormat: 'hidden' });
      } catch (err2: any) {
        logNvidiaError('callNvidiaOnce failed after rate-limit retry', err2);
        throw new Error(
          `NVIDIA NIM chat.completions failed after rate-limit retry: ${err2?.message ?? String(err2)}`,
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
      `[nvidiaClient chatJSON] first response was not valid JSON; retrying once. Raw (truncated): ${firstText.slice(0, 200)}`,
    );
  }

  const retryMessages: any[] = [
    ...baseMessages,
    { role: 'assistant', content: firstText },
    { role: 'system', content: JSON_REMINDER },
  ];

  let retryCompletion: any;
  try {
    retryCompletion = await callNvidiaOnce({ model, messages: retryMessages, reasoningFormat: 'hidden' });
  } catch (err: any) {
    if (isRateLimitError(err)) {
      const waitMs = parseRateLimitWaitMs(err) + RATE_LIMIT_BUFFER_MS;
      console.warn(
        `[nvidiaClient chatJSON] Rate limited on JSON-retry, waiting ${(waitMs / 1000).toFixed(1)}s before retry`,
      );
      await sleep(waitMs);
      try {
        retryCompletion = await callNvidiaOnce({ model, messages: retryMessages, reasoningFormat: 'hidden' });
      } catch (err2: any) {
        logNvidiaError('callNvidiaOnce failed on JSON-retry after rate-limit retry', err2);
        throw new Error(
          `NVIDIA NIM chat.completions JSON-retry failed after rate-limit retry: ${err2?.message ?? String(err2)}`,
        );
      }
    } else {
      throw err;
    }
  }

  const retryText = extractContent(retryCompletion);
  return parseOrLog<T>(retryText, 'attempt 2 (JSON-retry)');
}
