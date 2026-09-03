/**
 * WebMCP tool registration.
 *
 * WebMCP tools are registered client-side via `document.modelContext.registerTool(...)`.
 * They run in the browser; their `execute` function calls our existing /api routes
 * via the Vite proxy. No server-side MCP server is involved.
 *
 * Feature detection: most browsers (and most judges testing without the Chrome
 * `--enable-features=WebMCP` flag or ChatGPT browser) won't expose
 * `document.modelContext`. We feature-detect and log clearly; the site works
 * normally either way.
 */

const API_BASE = '/api';

export const WEBMCP_TOOL_NAMES = [
  'analyze_video',
  'get_audience_themes',
  'get_top_requests',
  'find_content_gaps',
  'search_comments',
] as const;

export type WebMCPToolName = (typeof WEBMCP_TOOL_NAMES)[number];

interface ModelContextAPI {
  registerTool(tool: WebMCPTool): void;
}

interface WebMCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (input: any) => Promise<any>;
}

function getModelContext(): ModelContextAPI | null {
  if (typeof document === 'undefined') return null;
  const ctx = (document as unknown as { modelContext?: ModelContextAPI }).modelContext;
  return ctx ?? null;
}

export function isWebMCPSupported(): boolean {
  return getModelContext() !== null;
}

async function fetchJson<T = any>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const message = body?.message ?? `Backend returned ${res.status}`;
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

function urlFromVideoId(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

const tools: WebMCPTool[] = [
  {
    name: 'analyze_video',
    description:
      'Run the full Comment Intelligence pipeline on a YouTube video URL: ' +
      'fetch comments, classify intent/topic/sentiment/urgency, cluster by theme, ' +
      'compute demand scores, detect content gaps, surface unanswered questions, ' +
      'and identify emerging topics. Returns everything needed to populate the ' +
      'dashboard in one call. Use this when the user pastes a new YouTube URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'Full YouTube URL. Accepted formats: https://www.youtube.com/watch?v=<id>, ' +
            'https://youtu.be/<id>, or https://www.youtube.com/shorts/<id>.',
        },
      },
      required: ['url'],
    },
    execute: async (input: { url: string }) => {
      const data = await fetchJson<any>(
        `${API_BASE}/test-intelligence?url=${encodeURIComponent(input.url)}`,
      );
      const slimOpps = (data.rankedOpportunities ?? []).slice(0, 5);
      const slimUnans = (data.unansweredQuestions ?? []).slice(0, 5).map((q: any) => ({
        topic: q.topic,
        questionCount: q.questionCount,
        representativeQuestions: (q.representativeQuestions ?? []).slice(0, 3),
      }));
      const slimEmerg = (data.emergingTopics ?? []).slice(0, 5);
      return {
        videoId: data.videoId,
        title: data.metadata?.title,
        channelTitle: data.metadata?.channelTitle,
        totalClassified: data.totalClassified,
        fromCache: data.fromCache,
        rankedOpportunities: slimOpps,
        contentGaps: data.contentGaps ?? [],
        unansweredQuestions: slimUnans,
        emergingTopics: slimEmerg,
        timing: data.timing,
      };
    },
  },

  {
    name: 'get_audience_themes',
    description:
      'Return the audience-request themes (clusters) discovered in an already-analyzed ' +
      'YouTube video. Each cluster is summarized with a human-readable themeLabel, ' +
      'size, dominant intent, and top representative comments. ' +
      'Call analyze_video(url) first if the video has not been analyzed yet. ' +
      'Use this to drill into what viewers are saying about a video.',
    inputSchema: {
      type: 'object',
      properties: {
        videoId: {
          type: 'string',
          description: '11-character YouTube video ID (e.g. "dQw4w9WgXcQ").',
        },
      },
      required: ['videoId'],
    },
    execute: async (input: { videoId: string }) => {
      const url = urlFromVideoId(input.videoId);
      const data = await fetchJson<any>(
        `${API_BASE}/test-cluster?url=${encodeURIComponent(url)}`,
      );
      const themes = (data.clusters ?? []).map((c: any) => ({
        topic: c.topic,
        themeLabel: c.themeLabel,
        themeDescription: c.themeDescription,
        size: c.size,
        dominantIntent: c.dominantIntent,
        averageUrgency: c.averageUrgency,
        representativeComments: (c.representativeComments ?? []).slice(0, 3),
        explicitRequestCount: c.explicitRequestCount,
        isUnknownTopic: c.isUnknownTopic,
        requestBreakdown: c.requestBreakdown,
      }));
      return {
        videoId: data.videoId,
        themeCount: themes.length,
        tailCount: data.tailCount ?? 0,
        themes,
      };
    },
  },

  {
    name: 'get_top_requests',
    description:
      'Return the top audience-request opportunities for an already-analyzed YouTube video, ' +
      'ranked 0-100 by demand score. IMPORTANT: demand != popularity. A cluster of 21 praise ' +
      'comments scores low (~20), while a cluster of 4 explicit "please upload daily!" requests ' +
      'scores high (~88). Each item includes the formula breakdown (volume, explicit-request ' +
      'ratio, urgency, intent-weight) and a one-line justification. ' +
      'Use to answer "what should this creator make next?".',
    inputSchema: {
      type: 'object',
      properties: {
        videoId: {
          type: 'string',
          description: '11-character YouTube video ID.',
        },
      },
      required: ['videoId'],
    },
    execute: async (input: { videoId: string }) => {
      const url = urlFromVideoId(input.videoId);
      const data = await fetchJson<any>(
        `${API_BASE}/test-demand?url=${encodeURIComponent(url)}`,
      );
      const requests = (data.rankedOpportunities ?? []).map((r: any) => ({
        topic: r.topic,
        themeLabel: r.breakdown
          ? r.topic
          : r.topic,
        score: r.score,
        breakdown: r.breakdown,
        justification: r.justification,
      }));
      return {
        videoId: data.videoId,
        totalRequests: requests.length,
        requests,
      };
    },
  },

  {
    name: 'find_content_gaps',
    description:
      'Return content gaps and unanswered audience questions for an already-analyzed ' +
      'YouTube video. Content gaps are audience-request clusters that the video ' +
      '(judged from title/description only) does NOT cover — these are the creator\'s ' +
      'action items. Unanswered questions are the top topics the audience asked about, ' +
      'with verbatim representative questions. Use to drive the "Gaps" dashboard section ' +
      'or answer "what topics should this creator cover next?".',
    inputSchema: {
      type: 'object',
      properties: {
        videoId: {
          type: 'string',
          description: '11-character YouTube video ID.',
        },
      },
      required: ['videoId'],
    },
    execute: async (input: { videoId: string }) => {
      const url = urlFromVideoId(input.videoId);
      const data = await fetchJson<any>(
        `${API_BASE}/test-intelligence?url=${encodeURIComponent(url)}`,
      );
      const unansweredQuestions = (data.unansweredQuestions ?? []).map((q: any) => ({
        topic: q.topic,
        questionCount: q.questionCount,
        representativeQuestions: (q.representativeQuestions ?? []).slice(0, 3),
      }));
      return {
        videoId: data.videoId,
        contentGaps: data.contentGaps ?? [],
        unansweredQuestions,
      };
    },
  },

  {
    name: 'search_comments',
    description:
      'Search the cached classified comments for an already-analyzed YouTube video by ' +
      'case-insensitive substring. Returns matching comments with their classification ' +
      '(intent/topic/sentiment/urgency/explicit_request). Use to find specific examples of ' +
      'audience feedback within a video — e.g. "all complaints about UI" or "mentions of TypeScript". ' +
      'Returns up to 50 matches per call.',
    inputSchema: {
      type: 'object',
      properties: {
        videoId: {
          type: 'string',
          description: '11-character YouTube video ID.',
        },
        query: {
          type: 'string',
          description: 'Case-insensitive substring to search in comment text (min 2 characters).',
        },
      },
      required: ['videoId', 'query'],
    },
    execute: async (input: { videoId: string; query: string }) => {
      const data = await fetchJson<any>(
        `${API_BASE}/search-comments?videoId=${encodeURIComponent(input.videoId)}` +
          `&q=${encodeURIComponent(input.query)}`,
      );
      return {
        videoId: data.videoId,
        query: data.query,
        matchCount: data.matchCount,
        truncated: data.truncated,
        matches: (data.matches ?? []).map((m: any) => ({
          id: m.id,
          text: m.text,
          intent: m.intent,
          topic: m.topic,
          subtopic: m.subtopic,
          sentiment: m.sentiment,
          urgency: m.urgency,
          explicit_request: m.explicit_request,
        })),
      };
    },
  },
];

let registered = false;

export function registerTools(): void {
  if (registered) return;
  registered = true;

  const ctx = getModelContext();
  if (!ctx) {
    console.warn(
      '[WebMCP] document.modelContext not available in this browser. ' +
        'WebMCP tools were NOT registered. The site works normally — this is expected ' +
        'unless you are running in a WebMCP-enabled browser (Chrome flag or ChatGPT browser).',
    );
    return;
  }

  console.log(
    `[WebMCP] Registering ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`,
  );
  let successCount = 0;
  for (const tool of tools) {
    try {
      ctx.registerTool(tool);
      console.log(`[WebMCP]   + registered ${tool.name}`);
      successCount += 1;
    } catch (err: any) {
      console.error(
        `[WebMCP]   x failed to register ${tool.name}: ${err?.message ?? String(err)}`,
      );
    }
  }
  if (successCount === tools.length) {
    console.log(`[WebMCP] All ${tools.length} tools registered successfully.`);
  } else {
    console.warn(
      `[WebMCP] ${successCount}/${tools.length} tools registered; site still works normally.`,
    );
  }
}
