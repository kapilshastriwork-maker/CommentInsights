import { useEffect } from 'react';
import { useAgent } from '../state/AgentContext';

export default function AgentDrawer() {
  const { open, close } = useAgent();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <>
      <div
        className={`agent-backdrop ${open ? 'agent-backdrop--visible' : ''}`}
        onClick={close}
        aria-hidden="true"
      />
      <aside
        className={`agent-drawer ${open ? 'agent-drawer--open' : ''}`}
        role="dialog"
        aria-label="Audience Agent"
        aria-hidden={!open}
      >
        <header className="agent-header">
          <h2 className="agent-title">
            <span aria-hidden="true">✨</span> Audience Agent
          </h2>
          <button
            type="button"
            className="agent-close"
            onClick={close}
            aria-label="Close agent"
          >
            ×
          </button>
        </header>
        <div className="agent-body">
          <div className="placeholder-card">
            Agent coming in Phase 6.
          </div>
        </div>
      </aside>
    </>
  );
}
