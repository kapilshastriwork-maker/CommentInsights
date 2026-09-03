import { useEffect, useState } from 'react';
import { getClusters, urlFromVideoId, AnalyzeError } from '../api/client';
import { useAnalysis } from '../state/AnalysisContext';

interface ClusterSummary {
  topic: string;
  size: number;
  representativeComments: string[];
  dominantIntent: string;
  themeLabel: string;
  themeDescription: string;
  isUnknownTopic: boolean;
  requestBreakdown: Array<{ label: string; count: number }> | null;
}

interface TailCluster {
  topic: string;
  size: number;
  isUnknownTopic: boolean;
}

interface ClustersPayload {
  videoId: string;
  clusters: ClusterSummary[];
  tail: TailCluster[];
}

export default function Themes() {
  const { result } = useAnalysis();
  const [data, setData] = useState<ClustersPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tailOpen, setTailOpen] = useState(false);

  useEffect(() => {
    if (!result) return;
    const url = urlFromVideoId(result.metadata.videoId);
    let cancelled = false;
    setError(null);
    setData(null);
    getClusters(url)
      .then((d) => {
        if (!cancelled) setData(d as ClustersPayload);
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
        <h1>Themes</h1>
        <p>Clustered themes from the comment corpus — what people are actually talking about.</p>
        <div className="placeholder-card">
          No data yet — analyze a video first.
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="page">
        <h1>Themes</h1>
        <div className="placeholder-card">Error: {error}</div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="page">
        <h1>Themes</h1>
        <div className="placeholder-card">Loading clusters…</div>
      </section>
    );
  }

  if (!data.clusters.length) {
    return (
      <section className="page">
        <h1>Themes</h1>
        <div className="placeholder-card">
          No themes found for this video.
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <h1>Themes</h1>
      <p className="page-meta">
        {data.clusters.length} main clusters + {data.tail.length} tail clusters
      </p>

      <div className="theme-list">
        {data.clusters.map((c) => {
          const key = c.topic;
          const isOpen = !!expanded[key];
          const hasBreakdown = Array.isArray(c.requestBreakdown) && c.requestBreakdown.length > 0;
          return (
            <div key={key} className="theme-card">
              <button
                type="button"
                className="theme-card-head"
                onClick={() =>
                  setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
                }
                aria-expanded={isOpen}
              >
                <div className="theme-card-head-main">
                  <div className="theme-card-label">{c.themeLabel}</div>
                  <div className="theme-card-desc">{c.themeDescription}</div>
                </div>
                <div className="theme-card-head-right">
                  <span className="badge badge--intent">
                    {c.dominantIntent.replace(/_/g, ' ')}
                  </span>
                  <span className="badge badge--size">{c.size} comments</span>
                  {c.isUnknownTopic && (
                    <span className="badge badge--unknown">unmapped</span>
                  )}
                </div>
              </button>

              {c.representativeComments.length > 0 && (
                <div className="theme-card-quotes">
                  {c.representativeComments.slice(0, 3).map((quote, i) => (
                    <blockquote key={i} className="theme-card-quote">
                      “{quote}”
                    </blockquote>
                  ))}
                </div>
              )}

              {isOpen && hasBreakdown && (
                <div className="theme-card-breakdown">
                  <div className="theme-card-breakdown-title">Request breakdown</div>
                  <ul className="theme-card-breakdown-list">
                    {c.requestBreakdown!.map((rb) => (
                      <li key={rb.label}>
                        <span>{rb.label}</span>
                        <span className="theme-card-breakdown-count">{rb.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {isOpen && !hasBreakdown && (
                <div className="theme-card-breakdown">
                  <div className="theme-card-breakdown-empty">
                    No structured request breakdown for this cluster.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {data.tail.length > 0 && (
        <div className="theme-tail">
          <button
            type="button"
            className="theme-tail-head"
            onClick={() => setTailOpen((v) => !v)}
            aria-expanded={tailOpen}
          >
            Other ({data.tail.length} small clusters){' '}
            <span className="theme-tail-caret">{tailOpen ? '▾' : '▸'}</span>
          </button>
          {tailOpen && (
            <ul className="theme-tail-list">
              {data.tail.map((t) => (
                <li key={t.topic}>
                  <span className="theme-tail-topic">{t.topic}</span>
                  <span className="badge badge--size">{t.size}</span>
                  {t.isUnknownTopic && (
                    <span className="badge badge--unknown">unmapped</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
