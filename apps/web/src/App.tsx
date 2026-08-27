import { useLayoutEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import QueuePage from './pages/QueuePage';
import ReviewDetailPage from './pages/ReviewDetailPage';
import ProvenancePage from './pages/ProvenancePage';
import NewReviewPage from './pages/NewReviewPage';
import ReviewReportPage from './pages/ReviewReportPage';
import AuditPage from './pages/AuditPage';
import TriageRulesPage from './pages/TriageRulesPage';

/**
 * Review UI routes (day-23 §2.1) plus the Day-26 provenance page, the
 * review-reorient AI-review slice (Phase 3), and the day-34 global audit
 * timeline. The review screen and provenance are the Phase-1 UI; the
 * `/reviews/*` routes are the pivot's entry point (paste a PR URL) and its
 * report surface (report + findings + fix suggestions); `/audit` is the
 * separate system-activity log.
 */

/**
 * Routes wrapped in a keyed, animating container. Keying on the current path
 * remounts the wrapper on every navigation so the `.page-transition` entrance
 * replays, and the scroll is reset *before paint* so a new page never opens
 * mid-scroll — the "screen jump" the shell's internally-scrolling `app-main`
 * would otherwise preserve.
 */
function AppRoutes(): JSX.Element {
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    // The wrapper's parent is `.app-main`, the shell's scroll container.
    ref.current?.parentElement?.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div key={location.pathname} ref={ref} className="page-transition">
      <Routes location={location}>
        <Route path="/" element={<Navigate to="/review" replace />} />
        <Route path="/review" element={<QueuePage />} />
        <Route path="/review/:id" element={<ReviewDetailPage />} />
        <Route path="/tasks/:id/provenance" element={<ProvenancePage />} />
        <Route path="/reviews/new" element={<NewReviewPage />} />
        <Route path="/reviews/:id" element={<ReviewReportPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/rules" element={<TriageRulesPage />} />
      </Routes>
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <AppShell>
      <AppRoutes />
    </AppShell>
  );
}
