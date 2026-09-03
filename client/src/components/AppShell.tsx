import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import AgentDrawer from './AgentDrawer';
import AnalysisGate from './AnalysisGate';

export default function AppShell() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <AnalysisGate />
        <Outlet />
      </main>
      <AgentDrawer />
    </div>
  );
}
