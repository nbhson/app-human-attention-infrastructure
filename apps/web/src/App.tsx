import { Navigate, Route, Routes } from 'react-router-dom';
import QueuePage from './pages/QueuePage';
import ReviewDetailPage from './pages/ReviewDetailPage';
import ProvenancePage from './pages/ProvenancePage';
import NewReviewPage from './pages/NewReviewPage';
import ReviewReportPage from './pages/ReviewReportPage';

/**
 * Review UI routes (day-23 §2.1) plus the Day-26 provenance page and the
 * review-reorient AI-review slice (Phase 3). The review screen and provenance
 * are the Phase-1 UI; the `/reviews/*` routes are the pivot's entry point
 * (paste a PR URL) and its report surface (report + findings + fix suggestions).
 */
export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/review" replace />} />
      <Route path="/review" element={<QueuePage />} />
      <Route path="/review/:id" element={<ReviewDetailPage />} />
      <Route path="/tasks/:id/provenance" element={<ProvenancePage />} />
      <Route path="/reviews/new" element={<NewReviewPage />} />
      <Route path="/reviews/:id" element={<ReviewReportPage />} />
    </Routes>
  );
}
