import { useState } from 'react';
import type { ReviewFinding, WritebackRecord } from '../api/reviews';
import { AlertTriangle } from '../components/Icons';
import { BreakdownTab } from '../components/BreakdownTab';
import { DiffTab } from '../components/DiffTab';
import { PRHealthScoreTab } from '../components/PRHealthScoreTab';
import { PRMetadataPanel } from '../components/PRMetadataPanel';
import { ReportStats } from '../components/ReportStats';
import { ReviewTab } from '../components/ReviewTab';
import { SummaryMetricsPanel } from '../components/SummaryMetricsPanel';
import { TraceTab } from '../components/TraceTab';
import { VerificationTab } from '../components/VerificationTab';
import { WritebackDetailModal } from '../components/WritebackDetailModal';
import { sortFindingsBySeverity } from '../components/severity';
import { DecisionBar } from '../components/report/DecisionBar';
import { ReportHeader } from '../components/report/ReportHeader';
import { ReportLoadError } from '../components/report/ReportLoadError';
import { ReportPendingView } from '../components/report/ReportPendingView';
import { ReviewReportSkeleton } from '../components/report/ReviewReportSkeleton';
import { TABS, tabBadge, tabTitle, type ReviewTabKey } from '../components/report/reportTabs';
import { TriageBanner } from '../components/report/TriageBanner';
import { useReviewReport } from './useReviewReport';

/**
 * AI review report page (review-reorient Phase 3) — the human-in-the-loop read
 * surface. A focused workspace in four parts, top to bottom:
 *
 *   1. Review context — the PR title / repo / provider, compact.
 *   2. AI review overview — verdict + "how much attention?" hero + severity split.
 *   3. Five investigation tabs (Review / Breakdown / Diff / AI trace /
 *      Verification), each a different lens on the same review.
 *   4. A sticky human-decision bar — the workflow's final, and only, gate.
 *
 * The selected finding is lifted here and shared across tabs, so the question
 * "which finding am I investigating?" stays answered as the reviewer moves from
 * findings → diff → trace → verification → decision.
 *
 * This component is the orchestrator: data fetching lives in `useReviewReport`,
 * and each rendered region (skeleton, load error, pending pipeline, header,
 * triage banner, decision bar) is extracted under `components/report/`.
 */
export default function ReviewReportPage(): JSX.Element {
  const report = useReviewReport();
  const [activeTab, setActiveTab] = useState<ReviewTabKey>('review');
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [writebackDetail, setWritebackDetail] = useState<WritebackRecord | null>(null);
  const [decisionOpen, setDecisionOpen] = useState(true);

  if (report.isLoading) {
    return <ReviewReportSkeleton />;
  }
  if (report.isError || !report.data) {
    return (
      <ReportLoadError message={report.error instanceof Error ? report.error.message : null} onRetry={report.refetch} />
    );
  }

  const data = report.data;

  // While the background worker is still processing, show a progressive status
  // with current stage, batch progress, and any findings already inserted.
  const isPending = data.reviewStatus !== 'complete' && data.reviewStatus !== 'error';
  if (isPending || data.reviewStatus === 'error') {
    return <ReportPendingView data={data} onRetry={report.retryReport} retrying={report.retrying} />;
  }

  const findings = sortFindingsBySeverity(data.findings);
  // Default the "currently investigating" focus to the worst finding until the
  // reviewer selects one explicitly; the selection then survives tab switches.
  const activeFindingId = selectedFindingId ?? findings[0]?.id ?? null;
  const selectedFinding = findings.find((finding) => finding.id === activeFindingId) ?? null;

  // The server decides whether the "write back" checkbox is even meaningful: a
  // write-back-disabled deployment (WRITEBACK_ENABLED=0) records the toggle as OFF
  // no matter what, so we disable + explain it instead of letting the reviewer tick
  // a box that silently does nothing. REQUEST_CHANGES never writes by design.
  const writebackArmed = data.writeback?.enabled ?? false;

  const selectFinding = (findingId: string): void => setSelectedFindingId(findingId);
  const openInDiff = (finding: ReviewFinding): void => {
    setSelectedFindingId(finding.id);
    setActiveTab('diff');
  };
  const openInVerification = (finding: ReviewFinding): void => {
    setSelectedFindingId(finding.id);
    setActiveTab('verification');
  };
  const openInReview = (findingId: string): void => {
    setSelectedFindingId(findingId);
    setActiveTab('review');
  };

  const healthScore = data.healthScore;

  return (
    <main style={{ maxWidth: 1120, margin: '0 auto', padding: '16px 16px 0' }}>
      {/* 1 — review context */}
      <ReportHeader
        prTitle={data.prTitle}
        repo={data.repo}
        prNumber={data.prNumber}
        prUrl={data.prUrl}
        aiProvider={data.aiProvider}
        model={data.model}
        createdAt={data.createdAt}
        completedAt={data.completedAt}
        selectedFinding={selectedFinding}
      />

      {/* PR Metadata (commits, CI status) */}
      {data.pullRequestMetadata && (
        <PRMetadataPanel
          commits={data.pullRequestMetadata.commits}
          checkStatus={data.pullRequestMetadata.checkStatus}
        />
      )}

      {/* 1b — triage rule flags, if any fired */}
      <TriageBanner rules={data.triage.matchedRules} verdict={data.overallVerdict} />

      {/* Transparency flag: the model output was truncated and repaired. */}
      {data.wasRepaired === true && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid var(--color-warning, #f0ad4e)',
            background: 'var(--color-surface)',
            color: 'var(--color-warning, #b45309)',
            fontSize: '0.85rem',
            fontWeight: 500,
          }}
        >
          <span aria-hidden="true">
            <AlertTriangle size={14} />
          </span>
          This review was truncated and auto-repaired by the parser — some findings may be incomplete or spurious.
          Verify before merging.
        </div>
      )}

      {/* 2 — AI review overview */}
      <ReportStats
        stats={data.stats}
        overallVerdict={data.overallVerdict}
        effectiveVerdict={data.effectiveVerdict}
        matchedRules={data.triage.matchedRules}
      />

      {/* 2b — summary & architectural impact + metrics visualization */}
      <SummaryMetricsPanel summary={data.summary} stats={data.stats} findings={findings} />

      {/* 3 — investigation tabs */}
      <nav role="tablist" aria-label="Review detail" className="review-tabs" style={{ marginTop: 20 }}>
        {TABS.map((tab) => {
          const selected = activeTab === tab.key;
          const badge = tabBadge(data, tab.key);
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTab(tab.key)}
              title={tabTitle(data, tab.key)}
              className={`review-tab${selected ? ' review-tab-active' : ''}`}
            >
              {tab.label}
              {badge !== undefined && <span className="review-tab-badge">{badge}</span>}
            </button>
          );
        })}
      </nav>

      <div className="review-tab-panel" key={activeTab}>
        {activeTab === 'review' && (
          <ReviewTab
            findings={findings}
            suggestions={data.suggestions}
            selectedFindingId={activeFindingId}
            onSelect={selectFinding}
            onOpenInDiff={openInDiff}
            onOpenVerification={openInVerification}
          />
        )}

        {activeTab === 'detail' && (
          <div style={{ marginTop: 16 }}>
            <PRHealthScoreTab
              healthScore={healthScore}
              findings={findings}
              stats={data.stats}
              onViewFinding={openInReview}
            />
          </div>
        )}

        {activeTab === 'verification' && (
          <VerificationTab
            verification={data.verification}
            findings={findings}
            selectedFindingId={activeFindingId}
            onSelectFinding={selectFinding}
            onOpenReview={openInReview}
          />
        )}

        {activeTab === 'diff' && (
          <DiffTab
            diff={data.diff}
            findings={findings}
            selectedFindingId={activeFindingId}
            onSelectFinding={selectFinding}
          />
        )}

        {activeTab === 'breakdown' && (
          <div style={{ marginTop: 16 }}>
            <BreakdownTab stats={data.stats} />
          </div>
        )}

        {activeTab === 'trace' && (
          <TraceTab
            trace={data.trace}
            createdAt={data.createdAt}
            completedAt={data.completedAt}
            stats={data.stats}
            findings={findings}
            overallVerdict={data.overallVerdict}
            recalledMemories={data.recalledMemories}
          />
        )}
      </div>

      {/* 4 — human decision */}
      <DecisionBar
        open={decisionOpen}
        onToggle={() => setDecisionOpen((open) => !open)}
        decision={report.decision}
        onDecisionChange={report.setDecision}
        writeback={report.writeback}
        onWritebackChange={report.setWriteback}
        comment={report.comment}
        onCommentChange={report.setComment}
        submitError={report.submitError}
        submitting={report.submitting}
        onSubmit={report.submitDecision}
        writebackArmed={writebackArmed}
        decisions={data.decisions}
        writebacks={data.writebacks}
        onOpenWriteback={setWritebackDetail}
      />

      {writebackDetail && <WritebackDetailModal record={writebackDetail} onClose={() => setWritebackDetail(null)} />}
    </main>
  );
}
