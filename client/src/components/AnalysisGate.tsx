import { Link } from 'react-router-dom';
import { useAnalysis } from '../state/AnalysisContext';

export default function AnalysisGate() {
  const { result } = useAnalysis();
  if (result) return null;

  return (
    <div className="analysis-gate" role="status">
      <span>
        No analysis loaded yet — paste a URL on the landing page to get started.
      </span>
      <Link to="/" className="analysis-gate-action">
        Go to landing →
      </Link>
    </div>
  );
}
