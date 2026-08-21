import { Navigate, Route, Routes } from 'react-router-dom';
import QueuePage from './pages/QueuePage';
import ReviewDetailPage from './pages/ReviewDetailPage';

/**
 * Review UI routes (day-23 §2.1). The review screen is the only Phase-1 UI;
 * everything else (metrics, observability) is Day 27.
 */
export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/review" replace />} />
      <Route path="/review" element={<QueuePage />} />
      <Route path="/review/:id" element={<ReviewDetailPage />} />
    </Routes>
  );
}
