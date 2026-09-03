import { useEffect, useState } from 'react';
import { getIntelligence, urlFromVideoId, AnalyzeError } from '../api/client';
import { useAnalysis } from '../state/AnalysisContext';

interface RankedOpportunity {
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

interface IntelligencePayload {
  rankedOpportunities: RankedOpportunity[];
}

const TOP_N = 5;

function scoreBandClass(score: number): string {
  if (score >= 70) return 'score-num score-num--high';
  if (score >= 40) return 'score-num score-num--mid';
  return 'score-num score-num--low';
}

export default function Requests() {
  const { result } = useAnalysis();
  const [data, setData] = useState<IntelligencePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!result) return;
    const url = urlFromVideoId(result.metadata.videoId);
    let cancelled = false;
    setError(null);
    setData(null);
    getIntelligence(url)
      .then((d) => {
        if (!cancelled) setData(d as IntelligencePayload);
      })
      .catch((err: AnalyzeError) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [result]);

  if (!result) {
    return (
      <section className="page">
        <h1>Requests</h1>
        <p>Top audience-request opportunities ranked by demand score (volume + explicit requests + urgency + intent weight).</p>
        <div className="placeholder-card">
          No data yet — analyze a video first.
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="page">
        <h1>Requests</h1>
        <div className="placeholder-card">Error: {error}</div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="page">
        <h1>Requests</h1>
        <div className="placeholder-card">Loading demand ranking…</div>
      </section>
    );
  }

  if (!data.rankedOpportunities.length) {
    return (
      <section className="page">
        <h1>Requests</h1>
        <div className="placeholder-card">
          No ranked opportunities for this video.
        </div>
      </section>
    );
  }

  const top = data.rankedOpportunities.slice(0, TOP_N);

  return (
    <section className="page">
      <h1>Requests</h1>
      <p className="page-meta">
        Top {top.length} of {data.rankedOpportunities.length} opportunities · demand ≠ popularity (a 21-comment praise cluster scores ~20; a 4-comment explicit "daily uploads" cluster scores ~88).
      </p>

      <ol className="request-list">
        {top.map((r, idx) => (
          <li key={r.topic} className="request-item">
            <div className="request-rank">#{idx + 1}</div>
            <div className="request-body">
              <div className="request-topic">{r.topic}</div>
              <div className="request-justification">{r.justification}</div>
            </div>
            <div className={scoreBandClass(r.score)}>
              <div className="score-num-value">{r.score}</div>
              <div className="score-num-label">demand</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
