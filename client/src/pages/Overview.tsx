import { useEffect, useState } from 'react';
import { getIntelligence, urlFromVideoId, AnalyzeError } from '../api/client';
import { useAnalysis } from '../state/AnalysisContext';

interface IntelligencePayload {
  videoId: string;
  metadata: { title: string; channelTitle: string; commentCount: number | null };
  totalClassified: number;
  intentBreakdown: Record<string, number>;
  sentimentBreakdown: Record<string, number>;
  rankedOpportunities: any[];
  contentGaps: any[];
  unansweredQuestions: any[];
  emergingTopics: any[];
}

const SENTIMENT_ORDER = ['positive', 'neutral', 'negative'] as const;
const INTENT_ORDER = [
  'content_request',
  'question',
  'agree_validate',
  'share_experience',
  'disagree_debate',
  'confusion',
  'praise',
  'other',
] as const;

function pct(part: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((100 * part) / total)}%`;
}

export default function Overview() {
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
    return <NoDataStub description="Top-level intelligence summary for a video: sentiment, intent mix, comment volume at a glance." />;
  }

  if (error) {
    return (
      <section className="page">
        <h1>Overview</h1>
        <div className="placeholder-card">Error: {error}</div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="page">
        <h1>Overview</h1>
        <div className="placeholder-card">Loading intelligence…</div>
      </section>
    );
  }

  const total = data.totalClassified;
  const intentEntries = INTENT_ORDER.map((k) => [k, data.intentBreakdown?.[k] ?? 0] as const)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const sentimentEntries = SENTIMENT_ORDER.map((k) => [
    k,
    data.sentimentBreakdown?.[k] ?? 0,
  ] as const);

  return (
    <section className="page">
      <h1>Overview</h1>

      <div className="video-card">
        <div className="video-card-meta">
          <div className="video-card-channel">{data.metadata.channelTitle}</div>
          <div className="video-card-title">{data.metadata.title}</div>
          <div className="video-card-stats">
            <span>
              <strong>{total.toLocaleString()}</strong> comments analyzed
            </span>
            {data.metadata.commentCount != null && (
              <span className="video-card-stats-muted">
                · {data.metadata.commentCount.toLocaleString()} reported on YouTube
              </span>
            )}
            <span className="video-card-stats-muted">· videoId: {data.videoId}</span>
          </div>
        </div>
      </div>

      <h2 className="section-h">Sentiment</h2>
      <div className="bar-list">
        {sentimentEntries.map(([k, v]) => (
          <BarRow
            key={k}
            label={k}
            value={v}
            total={total}
            colorClass={`intelligence-bar-fill--sentiment-${k}`}
          />
        ))}
      </div>

      <h2 className="section-h">Intent mix</h2>
      <div className="bar-list">
        {intentEntries.map(([k, v]) => (
          <BarRow
            key={k}
            label={k.replace(/_/g, ' ')}
            value={v}
            total={total}
            colorClass={`intelligence-bar-fill--intent-${k}`}
          />
        ))}
      </div>
    </section>
  );
}

function BarRow({
  label,
  value,
  total,
  colorClass,
}: {
  label: string;
  value: number;
  total: number;
  colorClass: string;
}) {
  const widthPct = total ? Math.max(2, Math.round((100 * value) / total)) : 0;
  return (
    <div className="bar-row">
      <div className="bar-row-label">{label}</div>
      <div className="bar-row-track">
        <div
          className={`bar-row-fill ${colorClass}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <div className="bar-row-value">
        {value.toLocaleString()} <span className="bar-row-pct">({pct(value, total)})</span>
      </div>
    </div>
  );
}

function NoDataStub({ description }: { description: string }) {
  return (
    <section className="page">
      <h1>Overview</h1>
      <p>{description}</p>
      <div className="placeholder-card">
        No data yet — analyze a video first.
      </div>
    </section>
  );
}
