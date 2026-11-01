import type { ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { isConfigured } from './lib/supabase';
import { BASE } from './lib/brand';
import { SessionProvider, useSession } from './state/session';
import { ToastProvider } from './state/toast';
import { CallProvider } from './state/call';
import { Spinner } from './components/ui';
import SetupPage from './pages/SetupPage';
import AuthPage from './pages/AuthPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import InvitePage from './pages/InvitePage';
import AppShell from './pages/AppShell';

function Gate({ children }: { children: ReactElement }) {
  const { session, loading } = useSession();
  const loc = useLocation();
  if (loading) return <div className="center-screen"><Spinner /></div>;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return children;
}

export default function App() {
  if (!isConfigured) return <SetupPage />;
  return (
    <ToastProvider>
      <SessionProvider>
        <CallProvider>
          <BrowserRouter basename={BASE || undefined}>
            <Routes>
              <Route path="/login" element={<AuthPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/invite/:code" element={<Gate><InvitePage /></Gate>} />
              <Route path="/app/:cid?/:chid?" element={<Gate><AppShell /></Gate>} />
              <Route path="*" element={<Navigate to="/app" replace />} />
            </Routes>
          </BrowserRouter>
        </CallProvider>
      </SessionProvider>
    </ToastProvider>
  );
}
