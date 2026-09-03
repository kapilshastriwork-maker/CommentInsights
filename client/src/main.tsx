import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from 'react-router-dom';
import AppShell from './components/AppShell';
import Landing from './pages/Landing';
import Overview from './pages/Overview';
import Themes from './pages/Themes';
import Requests from './pages/Requests';
import Gaps from './pages/Gaps';
import { AnalysisProvider } from './state/AnalysisContext';
import { AgentProvider } from './state/AgentContext';
import { registerTools } from './webmcp/registerTools';
import './index.css';
import './App.css';

registerTools();

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  {
    path: '/app',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/app/overview" replace /> },
      { path: 'overview', element: <Overview /> },
      { path: 'themes', element: <Themes /> },
      { path: 'requests', element: <Requests /> },
      { path: 'gaps', element: <Gaps /> },
    ],
  },
  { path: '/overview', element: <Navigate to="/app/overview" replace /> },
  { path: '/themes', element: <Navigate to="/app/themes" replace /> },
  { path: '/requests', element: <Navigate to="/app/requests" replace /> },
  { path: '/gaps', element: <Navigate to="/app/gaps" replace /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AnalysisProvider>
      <AgentProvider>
        <RouterProvider router={router} />
      </AgentProvider>
    </AnalysisProvider>
  </StrictMode>,
);
