import { useEffect, useState } from 'react';
import { getIntelligence, urlFromVideoId, AnalyzeError } from '../api/client';
import { useAnalysis } from '../state/AnalysisContext';

interface ContentGap {
  topic: string;
  coverageStatus: 'covered' | 'partially_covered' | 'not_covered';
  reasoning: string;
}

interface UnansweredQuestion {
  topic: string;
  questionCount: number;
  representativeQuestions: string[];
}

interface EmergingTopic {
  topic: string;
  earlyCount: number;
  lateCount: number;
  growthRatio: number;
}

interface IntelligencePayload {
  contentGaps: ContentGap[];
  unansweredQuestions: UnansweredQuestion[];
  emergingTopics: EmergingTopic[];
}

function coverageBadgeClass(status: ContentGap['coverageStatus']): string {
  return `badge badge--coverage badge--coverage-${status}`;
}

function coverageLabel(status: ContentGap['coverageStatus']): string {
  return status.replace(/_/g, ' ');
}

export default function Gaps() {
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
        <h1>Gaps</h1>
        <p>Content gaps and unanswered questions the next piece of content could fill.</p>
        <div className="placeholder-card">
          No data yet — analyze a video first.
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="page">
        <h1>Gaps</h1>
        <div className="placeholder-card">Error: {error}</div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="page">
        <h1>Gaps</h1>
        <div className="placeholder-card">Loading intelligence…</div>
      </section>
    );
  }

  const totalSections =
    (data.contentGaps.length ? 1 : 0) +
    (data.unansweredQuestions.length ? 1 : 0) +
    (data.emergingTopics.length ? 1 : 0);

  if (totalSections === 0) {
    return (
      <section className="page">
        <h1>Gaps</h1>
        <div className="placeholder-card">
          No gaps, unanswered questions, or emerging topics detected for this video.
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <h1>Gaps</h1>

      {data.contentGaps.length > 0 && (
        <>
          <h2 className="section-h">Content gaps</h2>
          <p className="page-meta">
            Audience-request clusters that the video (judged from title + description) does not cover.
          </p>
          <ul className="gap-list">
            {data.contentGaps.map((g) => (
              <li key={g.topic} className="gap-item">
                <div className="gap-item-head">
                  <div className="gap-item-topic">{g.topic}</div>
                  <span className={coverageBadgeClass(g.coverageStatus)}>
                    {coverageLabel(g.coverageStatus)}
                  </span>
                </div>
                <div className="gap-item-reasoning">{g.reasoning}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.unansweredQuestions.length > 0 && (
        <>
          <h2 className="section-h">Unanswered questions</h2>
          <p className="page-meta">
            Questions the audience asked, grouped by topic, sorted by frequency.
          </p>
          <ul className="question-list">
            {data.unansweredQuestions.map((q) => (
              <li key={q.topic} className="question-item">
                <div className="question-item-head">
                  <div className="question-item-topic">{q.topic}</div>
                  <span className="badge badge--size">{q.questionCount} questions</span>
                </div>
                {q.representativeQuestions.length > 0 && (
                  <ul className="question-item-samples">
                    {q.representativeQuestions.slice(0, 3).map((rq, i) => (
                      <li key={i}>“{rq}”</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {data.emergingTopics.length > 0 && (
        <>
          <h2 className="section-h">Emerging topics</h2>
          <p className="page-meta">
            Topics gaining traction in the latter half of comments (latest signals about where audience attention is going).
          </p>
          <ul className="emerging-list">
            {data.emergingTopics.map((e) => (
              <li key={e.topic} className="emerging-item">
                <div className="emerging-topic">{e.topic}</div>
                <div className="emerging-meta">
                  early {e.earlyCount} → late {e.lateCount}
                </div>
                <div className="emerging-ratio">{e.growthRatio.toFixed(2)}×</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
