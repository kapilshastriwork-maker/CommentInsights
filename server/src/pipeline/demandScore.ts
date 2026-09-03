/**
 * Demand Score — Phase 4 (Intelligence Layer), part 1.
 *
 * Computes a transparent 0-100 demand score per cluster, ranking audience
 * signals by how actionable they are for a creator deciding what to make next.
 *
 * Core invariant: DEMAND ≠ POPULARITY. A cluster of 21 "great video!" comments
 * has high raw volume but zero demand for new content. A cluster of 4 explicit
 * "please upload daily!" requests has low volume but very high demand. The
 * formula below is designed so the second cluster outranks the first.
 *
 * Formula (weighted sum, all factors on 0-100 scale, weights sum to 1.0):
 *
 *   score = 0.20 * volumeScore
 *         + 0.30 * explicitRequestScore
 *         + 0.20 * urgencyScore
 *         + 0.30 * intentWeightScore
 *
 * Factor definitions:
 *
 *   volumeScore          — log-saturated cluster size.
 *                          100 * log(size + 1) / log(MAX_REASONABLE_SIZE + 1),
 *                          capped at 100. Caps prevent a single huge praise
 *                          cluster from dominating on raw volume. Saturation
 *                          at MAX_REASONABLE_SIZE = 20 comments — most real
 *                          "request" clusters live well under 20, while a
 *                          21-comment praise cluster saturates and gets
 *                          demoted by intent weight.
 *
 *   explicitRequestScore — 100 * (explicitRequestCount / size).
 *                          Direct ratio. Zero if size=0. The single most
 *                          honest signal: "did the viewer literally say
 *                          please/give me/make this?"
 *
 *   urgencyScore         — 100 * (averageUrgency - 1) / 2.
 *                          Maps 1.0 (low) -> 0, 2.0 (medium) -> 50,
 *                          3.0 (high) -> 100. Linear interpolation.
 *
 *   intentWeightScore    — hardcoded map of dominantIntent -> 0-100. This is
 *                          the demand≠popularity lever: praise/agree_validate
 *                          collapse to ~0 so they can never win.
 *
 * Intent weight table (DEMAND_INTENT_WEIGHTS):
 *
 *   content_request   100  "please make a video on X" — literal request
 *   question           80  "how do I...?" — strong informational demand
 *   confusion          50  "I'm lost" — ambiguous, may signal need
 *   disagree_debate    30  "you're wrong" — mild demand for rebuttal
 *   share_experience   20  audience sharing, not requesting
 *   other              10  no signal
 *   agree_validate      5  popularity signal only, NOT demand
 *   praise              0  pure praise is not demand
 *
 * Justification string format:
 *   "<size> comments (<pctOfTotal>% of total), <expReqPct>% explicit requests,
 *    avg urgency <avgUrg>, dominant intent: <themeLabel>"
 *
 *   Numbers-first, no narrative padding. The user can verify the score by
 *   hand from the listed inputs. No LLM call — this file is pure computation.
 *
 * Diversity decision: commenter diversity was DROPPED in this round. Reason:
 * ClassifiedComment does not carry an `author` field, so recovering commenter
 * identity requires joining back to RawComment via the cleaned cache, which
 * in turn requires re-deriving clusters by topic (the clusterAllComments
 * orchestrator does not currently expose per-cluster comment arrays after
 * summarizing). The four factors above already capture the demand signal
 * cleanly; adding a noisy 5th factor (5 representative authors per cluster
 * is too small a sample) would complicate future weight tuning without
 * honest precision gain. Volume already captures audience breadth.
 */

import type { ClusterSummary, CommentIntent } from './types';

export const DEMAND_INTENT_WEIGHTS: Record<CommentIntent, number> = {
  content_request: 100,
  question: 80,
  confusion: 50,
  disagree_debate: 30,
  share_experience: 20,
  other: 10,
  agree_validate: 5,
  praise: 0,
};

export const DEMAND_WEIGHTS = {
  volume: 0.2,
  explicitRequest: 0.3,
  urgency: 0.2,
  intentWeight: 0.3,
} as const;

const MAX_REASONABLE_SIZE = 20;
const LOG_DENOM = Math.log(MAX_REASONABLE_SIZE + 1);

export interface DemandScore {
  topic: string;
  score: number;
  breakdown: {
    volumeScore: number;
    explicitRequestScore: number;
    urgencyScore: number;
    intentWeightScore: number;
  };
  justification: string;
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function computeVolumeScore(size: number): number {
  if (size <= 0) return 0;
  const raw = (100 * Math.log(size + 1)) / LOG_DENOM;
  return clamp(raw, 0, 100);
}

function computeExplicitRequestScore(explicitRequestCount: number, size: number): number {
  if (size <= 0) return 0;
  return clamp((100 * explicitRequestCount) / size, 0, 100);
}

function computeUrgencyScore(averageUrgency: number): number {
  const clamped = clamp(averageUrgency, 1, 3);
  return clamp((100 * (clamped - 1)) / 2, 0, 100);
}

function computeIntentWeightScore(dominantIntent: CommentIntent): number {
  const w = DEMAND_INTENT_WEIGHTS[dominantIntent];
  if (typeof w === 'number') return w;
  console.warn(
    `[demandScore] unknown dominantIntent "${dominantIntent}"; defaulting to 0`,
  );
  return 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildJustification(args: {
  cluster: ClusterSummary;
  totalComments: number;
  volumeScore: number;
  explicitRequestScore: number;
  urgencyScore: number;
  intentWeightScore: number;
}): string {
  const { cluster, totalComments, urgencyScore } = args;
  const pctOfTotal =
    totalComments > 0
      ? round1((100 * cluster.size) / totalComments)
      : 0;
  const expReqPct =
    cluster.size > 0
      ? round1((100 * cluster.explicitRequestCount) / cluster.size)
      : 0;
  const avgUrg = round1(cluster.averageUrgency);
  const theme = cluster.themeLabel || cluster.topic;
  return `${cluster.size} comments (${pctOfTotal}% of total), ${expReqPct}% explicit requests, avg urgency ${avgUrg}, dominant intent: ${theme}`;
}

export function scoreCluster(
  cluster: ClusterSummary,
  totalComments: number,
): DemandScore {
  const volumeScore = round1(computeVolumeScore(cluster.size));
  const explicitRequestScore = round1(
    computeExplicitRequestScore(cluster.explicitRequestCount, cluster.size),
  );
  const urgencyScore = round1(computeUrgencyScore(cluster.averageUrgency));
  const intentWeightScore = computeIntentWeightScore(cluster.dominantIntent);

  const rawScore =
    DEMAND_WEIGHTS.volume * volumeScore +
    DEMAND_WEIGHTS.explicitRequest * explicitRequestScore +
    DEMAND_WEIGHTS.urgency * urgencyScore +
    DEMAND_WEIGHTS.intentWeight * intentWeightScore;
  const score = Math.round(clamp(rawScore, 0, 100));

  return {
    topic: cluster.topic,
    score,
    breakdown: {
      volumeScore,
      explicitRequestScore,
      urgencyScore,
      intentWeightScore,
    },
    justification: buildJustification({
      cluster,
      totalComments,
      volumeScore,
      explicitRequestScore,
      urgencyScore,
      intentWeightScore,
    }),
  };
}

export function rankOpportunities(
  clusters: ClusterSummary[],
  totalComments: number,
): DemandScore[] {
  if (!Array.isArray(clusters) || clusters.length === 0) return [];
  if (totalComments <= 0) {
    console.warn(
      `[demandScore] rankOpportunities called with totalComments=${totalComments}; returning empty array.`,
    );
    return [];
  }
  const scored = clusters.map((c) => scoreCluster(c, totalComments));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.breakdown.volumeScore !== a.breakdown.volumeScore) {
      return b.breakdown.volumeScore - a.breakdown.volumeScore;
    }
    return a.topic.localeCompare(b.topic);
  });
  return scored;
}
