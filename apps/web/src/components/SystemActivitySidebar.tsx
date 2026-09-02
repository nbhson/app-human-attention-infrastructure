import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { auditApi, type AuditEntry, type AuditKind } from '../api/audit';
import { KIND_FILTERS, KIND_LABEL, kindClass, repoFromEntry, timeAgo } from './auditMeta';
import { Activity, Maximize2, Minimize2, Radio, RefreshCw, Search, X } from './Icons';

/**
 * System Activity panel (reference: SystemActivitySidebar) — a right-hand,
 * toggleable telemetry stream over the real `/api/audit` timeline. Rendered by
 * `ActivityPanelProvider`, which also owns the app-wide `⌘J` / `Esc` handling.
 *
 * Deliberately honest: the "Simulate webhook" and "Clear logs" actions from the
 * mockup are omitted (there is no backend endpoint for either, and clearing an
 * append-only audit trail would be misleading); the health cards show derivable
 * counts or `—` rather than invented latencies/quotas.
 */

interface ActivityPanelContextValue {
  readonly isOpen: boolean;
  readonly toggle: () => void;
  readonly open: () => void;
  readonly close: () => void;
}

const ActivityPanelContext = createContext<ActivityPanelContextValue | null>(null);

const NOOP_PANEL: ActivityPanelContextValue = {
  isOpen: false,
  toggle: () => {},
  open: () => {},
  close: () => {},
};

/** Read the panel controls; safe outside the provider (pages render standalone). */
export function useActivityPanel(): ActivityPanelContextValue {
  return useContext(ActivityPanelContext) ?? NOOP_PANEL;
}

export function ActivityPanelProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo<ActivityPanelContextValue>(
    () => ({ isOpen, open, close, toggle }),
    [isOpen, open, close, toggle],
  );

  return <ActivityPanelContext.Provider value={value}>{children}</ActivityPanelContext.Provider>;
}

type FilterType = AuditKind | 'all';

export function SystemActivitySidebar(): JSX.Element {
  const { isOpen, close } = useActivityPanel();
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [isExpandedWidth, setIsExpandedWidth] = useState(false);

  const { data, refetch } = useQuery({
    queryKey: ['auditStream'],
    queryFn: () => auditApi.list({ limit: 50 }),
    refetchInterval: isOpen && !isPaused ? 5_000 : false,
  });
  const items = data?.items ?? [];

  const filteredLogs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return items.filter((log) => {
      if (filterType !== 'all' && log.kind !== filterType) return false;
      if (query.length === 0) return true;
      const repo = repoFromEntry(log.detail);
      return [log.title, log.summary, log.kind, repo ?? ''].join(' ').toLowerCase().includes(query);
    });
  }, [items, filterType, searchQuery]);

  const eventCount = items.filter((log) => log.kind === 'event').length;
  const llmCount = items.filter((log) => log.kind === 'llm').length;

  if (!isOpen) return <></>;

  return (
    <aside className={`sa-sidebar${isExpandedWidth ? ' sa-sidebar--wide' : ''}`} aria-label="System activity panel">
      <div className="sa-sidebar-head">
        <div className="sa-sidebar-brand">
          <div className="sa-sidebar-mark">
            <Activity />
          </div>
          <div className="sa-sidebar-titles">
            <div className="sa-sidebar-title-row">
              <h2 className="sa-sidebar-title">System Activity</h2>
              <span className="sa-live">
                <span className={`sa-live-dot${isPaused ? ' sa-live-paused' : ''}`} aria-hidden="true" />
                {isPaused ? 'PAUSED' : 'LIVE'}
              </span>
            </div>
            <span className="sa-sidebar-sub">HAI AI Engine Telemetry &amp; Events</span>
          </div>
        </div>

        <div className="sa-sidebar-controls">
          <button
            type="button"
            className="sa-icon-btn"
            onClick={() => setIsExpandedWidth((prev) => !prev)}
            title={isExpandedWidth ? 'Normal width' : 'Expand width'}
            aria-label={isExpandedWidth ? 'Normal width' : 'Expand width'}
          >
            {isExpandedWidth ? <Minimize2 /> : <Maximize2 />}
          </button>
          <button
            type="button"
            className="sa-icon-btn"
            onClick={() => void refetch()}
            title="Refresh stream"
            aria-label="Refresh stream"
          >
            <RefreshCw className="sa-icon-refresh" />
          </button>
          <button
            type="button"
            className="sa-icon-btn"
            onClick={close}
            title="Close sidebar"
            aria-label="Close activity panel"
          >
            <X className="sa-icon-close" />
          </button>
        </div>
      </div>

      <div className="sa-sidebar-telemetry">
        <div className="sa-telemetry-grid">
          <div className="sa-telemetry-card">
            <span className="sa-telemetry-label">Latency</span>
            <div className="sa-telemetry-value-row">
              <span className="sa-telemetry-value">—</span>
            </div>
          </div>
          <div className="sa-telemetry-card">
            <span className="sa-telemetry-label">Events</span>
            <div className="sa-telemetry-value-row">
              <span className="sa-telemetry-dot" aria-hidden="true" />
              <span className="sa-telemetry-value">{eventCount}</span>
            </div>
          </div>
          <div className="sa-telemetry-card">
            <span className="sa-telemetry-label">LLM Calls</span>
            <div className="sa-telemetry-value-row">
              <span className="sa-telemetry-value sa-telemetry-value--purple">{llmCount}</span>
              <span className="sa-telemetry-hint">in stream</span>
            </div>
          </div>
        </div>

        <div className="sa-telemetry-controls">
          <button
            type="button"
            className={`sa-pause-btn${isPaused ? ' sa-pause-btn--active' : ''}`}
            onClick={() => setIsPaused((prev) => !prev)}
          >
            {isPaused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>

      <div className="sa-sidebar-search">
        <div className="sa-search">
          <Search className="sa-search-icon" />
          <input
            type="text"
            className="sa-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search activity stream..."
            aria-label="Search activity stream"
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              className="sa-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              <X />
            </button>
          )}
        </div>

        <div className="sa-pills">
          {(['all', ...KIND_FILTERS] as const).map((type) => (
            <button
              key={type}
              type="button"
              className={`sa-pill${filterType === type ? ' sa-pill-active' : ''}`}
              onClick={() => setFilterType(type)}
            >
              {type}
            </button>
          ))}
          <span className="sa-pill-count">{filteredLogs.length} events</span>
        </div>
      </div>

      <div className="sa-sidebar-feed">
        {filteredLogs.length === 0 ? (
          <div className="sa-feed-empty">
            <Radio />
            <p className="sa-feed-empty-title">No telemetry logs found</p>
            <span className="sa-feed-empty-text">Try adjusting your search query or trigger an action.</span>
          </div>
        ) : (
          filteredLogs.map((log) => (
            <SidebarLogRow
              key={log.id}
              log={log}
              isOpen={expandedLogId === log.id}
              onToggle={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
            />
          ))
        )}
      </div>

      <div className="sa-sidebar-foot">
        <div className="sa-foot-status">
          <span className="sa-foot-dot" aria-hidden="true" />
          <span>AI Engine Active</span>
        </div>
        <span className="sa-foot-version">v2.5.0</span>
      </div>
    </aside>
  );
}

function SidebarLogRow({
  log,
  isOpen,
  onToggle,
}: {
  readonly log: AuditEntry;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  const repo = repoFromEntry(log.detail);
  return (
    <button
      type="button"
      className={`sa-sidebar-log${isOpen ? ' sa-sidebar-log--open' : ''}`}
      onClick={onToggle}
      aria-expanded={isOpen}
    >
      <div className="sa-sidebar-log-head">
        <div className="sa-sidebar-log-tags">
          <span className={`sa-log-type ${kindClass(log.kind)}`}>{KIND_LABEL[log.kind]}</span>
          <span className="sa-sidebar-log-repo">{repo ?? log.title}</span>
        </div>
        <span className="sa-sidebar-log-time">{timeAgo(log.occurredAt)}</span>
      </div>

      <p className="sa-sidebar-log-message">{log.summary}</p>

      {isOpen && (
        <div className="sa-sidebar-log-payload">
          <div className="sa-payload-meta">
            <span>Event ID: {log.id}</span>
            {repo !== null && <span>Target: {repo}</span>}
          </div>
          <pre className="sa-payload-code">{JSON.stringify(log.detail, null, 2)}</pre>
        </div>
      )}
    </button>
  );
}
