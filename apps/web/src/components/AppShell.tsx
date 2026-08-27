import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { reviewsApi } from '../api/reviews';
import { Activity, Command, Inbox, Plus, Sliders, X } from './Icons';
import {
  ActivityPanelProvider,
  SystemActivitySidebar,
  useActivityPanel,
} from './SystemActivitySidebar';

/**
 * Application shell — the persistent left sidebar, the internally-scrolling
 * main area, and the toggleable right-hand System Activity panel, ported to
 * match the reference mockup's three-column layout. The sidebar owns the brand
 * block, the primary "Create New Review" action, the three workspaces, and a
 * status/shortcuts footer. Pages mount into `children`; the shell only
 * owns chrome, so a nav change never re-mounts a page's state.
 *
 * The `ActivityPanelProvider` wraps everything below so the left-nav
 * "System Activity" item and the queue header can both read and toggle the
 * panel (it is request-scoped app-wide, not tied to a single route); the panel
 * itself renders as the third flex column, squeezing `app-main` on the right.
 */

function navItemClass({ isActive }: { isActive: boolean }): string {
  return `nav-item${isActive ? ' nav-item-active' : ''}`;
}

const SHORTCUTS: ReadonlyArray<{ readonly keys: string; readonly desc: string }> = [
  { keys: '/', desc: 'Focus Search Bar' },
  { keys: '⌘K', desc: 'Open Keyboard Shortcuts' },
  { keys: '⌘J', desc: 'Toggle Activity Panel' },
  { keys: 'Esc', desc: 'Close Modal or Dialog' },
];

export function AppShell({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <ActivityPanelProvider>
      <AppShellLayout>{children}</AppShellLayout>
    </ActivityPanelProvider>
  );
}

function AppShellLayout({ children }: { readonly children: ReactNode }): JSX.Element {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { isOpen: isActivityOpen, toggle: toggleActivityPanel } = useActivityPanel();
  const { data: summary } = useQuery({
    queryKey: ['reviewsSummary'],
    queryFn: () => reviewsApi.summary(),
  });

  const pendingCount = summary?.pendingCount ?? 0;

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShortcutsOpen((open) => !open);
      } else if (e.key === 'Escape') {
        setShortcutsOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <Link to="/review" className="sidebar-brand-link" aria-label="HAI Harness home">
              <span className="sidebar-brand-mark" aria-hidden="true">
                HAI
              </span>
              <span className="sidebar-brand-name">
                <span className="sidebar-brand-name-row">
                  <span className="name">Harness</span>
                  <span className="sidebar-brand-badge">v2.5</span>
                </span>
                <span className="sidebar-brand-sub">AI Review Agent</span>
              </span>
            </Link>
          </div>

          <Link to="/reviews/new" className="sidebar-create">
            <Plus />
            <span>Create New Review</span>
          </Link>

          <nav className="sidebar-nav" aria-label="Workspace">
            <NavLink to="/review" end className={navItemClass} data-accent="blue">
              <span className="nav-item--left">
                <Inbox className="nav-item-icon" />
                <span>Review Queue</span>
              </span>
              {pendingCount > 0 && (
                <span className="nav-badge nav-badge--blue">{pendingCount}</span>
              )}
            </NavLink>

            <button
              type="button"
              className={`nav-item${isActivityOpen ? ' nav-item--activity-open' : ''}`}
              onClick={toggleActivityPanel}
              aria-pressed={isActivityOpen}
            >
              <span className="nav-item--left">
                <Activity className="nav-item-icon" />
                <span>System Activity</span>
              </span>
              <span className="nav-badge nav-badge--panel">
                <span className="nav-ping" aria-hidden="true" />
                Panel
              </span>
            </button>

            <NavLink to="/rules" end className={navItemClass} data-accent="purple">
              <span className="nav-item--left">
                <Sliders className="nav-item-icon" />
                <span>Triage Rules</span>
              </span>
              <span className="nav-badge nav-badge--active">Active</span>
            </NavLink>
          </nav>
        </div>

        <div className="sidebar-foot">
          <button
            type="button"
            className="sidebar-shortcuts"
            onClick={() => setShortcutsOpen(true)}
          >
            <span className="sidebar-shortcuts-left">
              <Command size={14} />
              Shortcuts
            </span>
            <span className="kbd">⌘K</span>
          </button>

          <div className="sidebar-status">
            <span className="sidebar-status-row">
              <span className="nav-ping" aria-hidden="true" />
              <span className="sidebar-status-title">AI Engine Active</span>
            </span>
            <span className="sidebar-status-sub">AI reviews waiting for human attention</span>
          </div>
        </div>
      </aside>

      <div className="app-main">{children}</div>
      <SystemActivitySidebar />

      {shortcutsOpen && (
        <div className="rq-modal" role="presentation" onClick={() => setShortcutsOpen(false)}>
          <div
            className="rq-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rq-modal-head">
              <span className="rq-modal-title-wrap">
                <Command size={16} />
                <h3 className="rq-modal-title">Keyboard Shortcuts</h3>
              </span>
              <button
                type="button"
                className="rq-modal-close"
                onClick={() => setShortcutsOpen(false)}
                aria-label="Close shortcuts"
              >
                <X />
              </button>
            </div>
            <div className="rq-modal-body">
              {SHORTCUTS.map((shortcut) => (
                <div className="rq-shortcut-row" key={shortcut.desc}>
                  <span className="rq-shortcut-desc">{shortcut.desc}</span>
                  <kbd className="rq-shortcut-key">{shortcut.keys}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
