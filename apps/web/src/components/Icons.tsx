/**
 * Shared inline-SVG icon set (landing-page rebuild) — lucide-equivalent strokes,
 * `stroke="currentColor"`, round caps. No new dependency: every icon is a plain
 * `<svg>` so it inherits `currentColor` and can be sized by surrounding CSS.
 */

export interface IconProps {
  /** Pixel size for both width and height. Defaults to 16. */
  readonly size?: number;
  readonly className?: string;
}

function glyph(size: number, className: string | undefined, children: JSX.Element[]): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function Inbox({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <polyline key="a" points="22 12 16 12 14 15 10 15 8 12 2 12" />,
    <path
      key="b"
      d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
    />,
  ]);
}

export function Activity({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [<path key="a" d="M22 12h-4l-3 9L9 3l-3 9H2" />]);
}

export function Plus({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [<path key="a" d="M5 12h14" />, <path key="b" d="M12 5v14" />]);
}

export function CheckCircle2({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <circle key="a" cx="12" cy="12" r="10" />,
    <path key="b" d="m9 12 2 2 4-4" />,
  ]);
}

export function Sliders({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <line key="a" x1="4" x2="4" y1="21" y2="14" />,
    <line key="b" x1="4" x2="4" y1="10" y2="3" />,
    <line key="c" x1="12" x2="12" y1="21" y2="12" />,
    <line key="d" x1="12" x2="12" y1="8" y2="3" />,
    <line key="e" x1="20" x2="20" y1="21" y2="16" />,
    <line key="f" x1="20" x2="20" y1="12" y2="3" />,
    <line key="g" x1="2" x2="6" y1="14" y2="14" />,
    <line key="h" x1="10" x2="14" y1="8" y2="8" />,
    <line key="i" x1="18" x2="22" y1="16" y2="16" />,
  ]);
}

export function Sparkles({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path
      key="a"
      d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"
    />,
  ]);
}

export function Zap({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <polygon key="a" points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  ]);
}

export function Clock({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <circle key="a" cx="12" cy="12" r="10" />,
    <polyline key="b" points="12 6 12 12 16 14" />,
  ]);
}

export function ShieldAlert({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
    <path key="b" d="M12 8v4" />,
    <path key="c" d="M12 16h.01" />,
  ]);
}

export function GitPullRequest({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <circle key="a" cx="18" cy="18" r="3" />,
    <circle key="b" cx="6" cy="6" r="3" />,
    <path key="c" d="M13 6h3a2 2 0 0 1 2 2v7" />,
    <line key="d" x1="6" x2="6" y1="9" y2="21" />,
  ]);
}

export function GitBranch({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <line key="a" x1="6" x2="6" y1="3" y2="15" />,
    <circle key="b" cx="18" cy="6" r="3" />,
    <circle key="c" cx="6" cy="18" r="3" />,
    <path key="d" d="M18 9a9 9 0 0 1-9 9" />,
  ]);
}

export function Star({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <polygon
      key="a"
      points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
    />,
  ]);
}

/** Bookmark (outline) — star variant used for the card's save-later toggle. */
export function Bookmark({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />,
  ]);
}

export function Check({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [<path key="a" d="M20 6 9 17l-5-5" />]);
}

export function AlertTriangle({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z" />,
    <path key="b" d="M12 9v4" />,
    <path key="c" d="M12 17h.01" />,
  ]);
}

export function MessageSquare({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  ]);
}

export function Search({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <circle key="a" cx="11" cy="11" r="8" />,
    <path key="b" d="m21 21-4.3-4.3" />,
  ]);
}

export function X({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [<path key="a" d="M18 6 6 18" />, <path key="b" d="m6 6 12 12" />]);
}

export function ChevronDown({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [<path key="a" d="m6 9 6 6 6-6" />]);
}

export function ChevronUp({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [<path key="a" d="m18 15-6-6-6 6" />]);
}

export function ArrowRight({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="M5 12h14" />,
    <path key="b" d="m12 5 7 7-7 7" />,
  ]);
}

export function Layers({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path
      key="a"
      d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"
    />,
    <path key="b" d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />,
    <path key="c" d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />,
  ]);
}

export function List({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <line key="a" x1="8" x2="21" y1="6" y2="6" />,
    <line key="b" x1="8" x2="21" y1="12" y2="12" />,
    <line key="c" x1="8" x2="21" y1="18" y2="18" />,
    <line key="d" x1="3" x2="3.01" y1="6" y2="6" />,
    <line key="e" x1="3" x2="3.01" y1="12" y2="12" />,
    <line key="f" x1="3" x2="3.01" y1="18" y2="18" />,
  ]);
}

export function Square({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [<rect key="a" width="18" height="18" x="3" y="3" rx="2" />]);
}

export function CheckSquare({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="m9 11 3 3L22 4" />,
    <path key="b" d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />,
  ]);
}

export function ArrowUpDown({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="m21 16-4 4-4-4" />,
    <path key="b" d="M17 20V4" />,
    <path key="c" d="m3 8 4-4 4 4" />,
    <path key="d" d="M7 4v16" />,
  ]);
}

export function Command({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />,
  ]);
}

export function ExternalLink({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="M15 3h6v6" />,
    <path key="b" d="M10 14 21 3" />,
    <path key="c" d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />,
  ]);
}

export function RefreshCw({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />,
    <path key="b" d="M21 3v5h-5" />,
    <path key="c" d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />,
    <path key="d" d="M3 21v-5h5" />,
  ]);
}

export function Minimize2({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="M4 14h6v6" />,
    <path key="b" d="M20 10h-6V4" />,
    <path key="c" d="m14 10 7-7" />,
    <path key="d" d="m3 21 7-7" />,
  ]);
}

export function Maximize2({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="M15 3h6v6" />,
    <path key="b" d="M9 21H3v-6" />,
    <path key="c" d="m21 3-7 7" />,
    <path key="d" d="m3 21 7-7" />,
  ]);
}

export function Radio({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />,
    <path key="b" d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.4" />,
    <circle key="c" cx="12" cy="12" r="2" />,
    <path key="d" d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.4" />,
    <path key="e" d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />,
  ]);
}

export function PieChart({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="M21.21 15.89A10 10 0 1 1 8 2.83" />,
    <path key="b" d="M22 12A10 10 0 0 0 12 2v10z" />,
  ]);
}

export function BarChart3({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="M3 3v16a2 2 0 0 0 2 2h16" />,
    <path key="b" d="M7 16v-5" />,
    <path key="c" d="M12 16V8" />,
    <path key="d" d="M17 16v-3" />,
  ]);
}

export function ShieldCheck({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
    <path key="b" d="m9 12 2 2 4-4" />,
  ]);
}

export function Copy({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <rect key="a" width="14" height="14" x="8" y="8" rx="2" ry="2" />,
    <path key="b" d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />,
  ]);
}

export function ChevronRight({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [<path key="a" d="m9 18 6-6-6-6" />]);
}

export function ArrowLeft({ size = 16, className }: IconProps): JSX.Element {
  return glyph(size, className, [
    <path key="a" d="m12 19-7-7 7-7" />,
    <path key="b" d="M19 12H5" />,
  ]);
}
