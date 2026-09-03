import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { analyzeUrl } from '../api/client';
import { useAnalysis } from '../state/AnalysisContext';

export default function Landing() {
  const { setResult } = useAnalysis();
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Please paste a YouTube or Instagram URL.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await analyzeUrl(trimmed);
      setResult(data);
      navigate('/app/overview');
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="landing">
      <div className="landing-card">
        <h1 className="landing-title">COMMENT → CONTENT INTELLIGENCE</h1>
        <p className="landing-subtitle">
          Understand what your audience wants next.
        </p>

        <form className="landing-form" onSubmit={handleSubmit}>
          <label className="landing-label" htmlFor="url-input">
            Video URL
          </label>
          <input
            id="url-input"
            className="input"
            type="url"
            placeholder="https://www.youtube.com/watch?v=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
            autoFocus
            spellCheck={false}
            autoComplete="off"
          />

          {error && (
            <div className="landing-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary"
            disabled={loading || !url.trim()}
          >
            {loading ? 'Analyzing…' : 'Analyze Audience'}
          </button>
        </form>

        <p className="landing-hint">
          YouTube URLs are fully supported today. Instagram and other platforms
          are detected but not yet ingested.
        </p>
      </div>
    </div>
  );
}
