import { Navigate, Route, Routes } from 'react-router-dom';
import QueuePage from './pages/QueuePage';
import ReviewDetailPage from './pages/ReviewDetailPage';
import ProvenancePage from './pages/ProvenancePage';

/**
 * Review UI routes (day-23 §2.1) plus the Day-26 provenance page. The review
 * screen and provenance are the Phase-1 UI; everything else (metrics,
 * observability) is Day 27.
 */
export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/review" replace />} />
      <Route path="/review" element={<QueuePage />} />
      <Route path="/review/:id" element={<ReviewDetailPage />} />
      <Route path="/tasks/:id/provenance" element={<ProvenancePage />} />
    </Routes>
  );
}
