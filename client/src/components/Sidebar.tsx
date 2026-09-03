import { NavLink, useNavigate } from 'react-router-dom';
import { useAnalysis } from '../state/AnalysisContext';
import { useAgent } from '../state/AgentContext';
import WebMCPBadge from './WebMCPBadge';

const sections = [
  { to: '/app/overview', label: 'Overview' },
  { to: '/app/themes', label: 'Themes' },
  { to: '/app/requests', label: 'Requests' },
  { to: '/app/gaps', label: 'Gaps' },
];

export default function Sidebar() {
  const { result, clearResult } = useAnalysis();
  const { toggle } = useAgent();
  const navigate = useNavigate();

  const handleNewAnalysis = () => {
    clearResult();
    navigate('/');
  };

  const footerLabel = result?.metadata?.title ?? 'No analysis loaded';

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-brand-line">COMMENT</span>
        <span className="sidebar-brand-arrow">→</span>
        <span className="sidebar-brand-line">CONTENT</span>
      </div>

      <nav className="sidebar-nav" aria-label="Primary">
        {sections.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            className={({ isActive }) =>
              isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link'
            }
          >
            {s.label}
          </NavLink>
        ))}
      </nav>

      <hr className="sidebar-divider" />

      <button
        type="button"
        className="agent-trigger"
        onClick={toggle}
        aria-label="Open Audience Agent"
      >
        <span aria-hidden="true">✨</span> Ask Audience Agent
      </button>

      <div className="sidebar-footer">
        <WebMCPBadge />
        <div className="sidebar-footer-label" title={footerLabel}>
          {footerLabel}
        </div>
        <button
          type="button"
          className="sidebar-footer-action"
          onClick={handleNewAnalysis}
        >
          + New analysis
        </button>
      </div>
    </aside>
  );
}
