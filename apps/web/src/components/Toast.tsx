import { useCallback, useEffect, useRef, useState } from 'react';

import { AlertTriangle, CheckCircle2, Sparkles, X, type IconProps } from './Icons';

/**
 * Single-toast helper for the queue's quick + bulk actions. Auto-dismisses after
 * ~3.5s; a new toast replaces the current one. Kept to one toast so a fast burst
 * of decisions doesn't stack a column of notifications down the screen.
 */

export type ToastType = 'success' | 'warning' | 'info';

export interface ToastData {
  readonly text: string;
  readonly type: ToastType;
}

export function useToast(): {
  readonly toast: ToastData | null;
  readonly showToast: (text: string, type?: ToastType) => void;
  readonly dismissToast: () => void;
} {
  const [toast, setToast] = useState<ToastData | null>(null);
  const timer = useRef<number | null>(null);

  const dismissToast = useCallback(() => setToast(null), []);

  const showToast = useCallback((text: string, type: ToastType = 'success') => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setToast({ text, type });
    timer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  return { toast, showToast, dismissToast };
}

const TOAST_ICON: Record<ToastType, (props: IconProps) => JSX.Element> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Sparkles,
};

const TOAST_COLOR: Record<ToastType, string> = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  info: 'var(--color-info)',
};

export function Toast({
  toast,
  onDismiss,
}: {
  readonly toast: ToastData;
  readonly onDismiss: () => void;
}): JSX.Element {
  const Icon = TOAST_ICON[toast.type];
  return (
    <div className="rq-toast" role="status">
      <span style={{ display: 'inline-flex', color: TOAST_COLOR[toast.type] }}>
        <Icon />
      </span>
      <span>{toast.text}</span>
      <button type="button" className="rq-toast-close" onClick={onDismiss} aria-label="Dismiss notification">
        <X />
      </button>
    </div>
  );
}
