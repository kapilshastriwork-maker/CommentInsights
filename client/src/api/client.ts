import type { AnalysisResult } from '../types';

const API_BASE = '/api';

export class AnalyzeError extends Error {
  status: number;
  code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AnalyzeError';
    this.status = status;
    this.code = code;
  }
}

async function getJson(endpoint: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(endpoint, { method: 'GET' });
  } catch (err: any) {
    throw new AnalyzeError(
      `Could not reach the backend at ${API_BASE}. ` +
        `Is the server running on port 4000? (${err?.message ?? 'network error'})`,
      0,
    );
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message =
      body?.message ?? `Backend returned ${res.status} ${res.statusText}`;
    throw new AnalyzeError(message, res.status, body?.error);
  }
  return body;
}

export async function analyzeUrl(url: string): Promise<AnalysisResult> {
  return (await getJson(
    `${API_BASE}/test-ingest?url=${encodeURIComponent(url)}`,
  )) as AnalysisResult;
}

export function urlFromVideoId(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export async function getIntelligence(url: string): Promise<any> {
  return getJson(
    `${API_BASE}/test-intelligence?url=${encodeURIComponent(url)}`,
  );
}

export async function getClusters(url: string): Promise<any> {
  return getJson(`${API_BASE}/test-cluster?url=${encodeURIComponent(url)}`);
}
