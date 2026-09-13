'use client';

import { useEffect } from 'react';
import { cx } from './ui';

export interface ToastMessage {
  text: string;
  tone?: 'default' | 'error';
}

/**
 * One transient message, bottom-right. Deliberately not a queue — the only
 * thing that raises a toast is "Run now", and stacking those would just tell
 * the reader the same thing twice.
 */
export function Toast({
  message,
  onDismiss,
  timeoutMs = 4000,
}: {
  message: ToastMessage | null;
  onDismiss: () => void;
  timeoutMs?: number;
}) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDismiss, timeoutMs);
    return () => clearTimeout(id);
  }, [message, onDismiss, timeoutMs]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'fixed right-6 bottom-6 z-50 flex items-center gap-3 rounded-card border bg-card px-4 py-3 text-sm shadow-sm',
        message.tone === 'error' ? 'border-down/30 text-down' : 'border-hairline text-ink'
      )}
    >
      {message.text}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-ink-faint transition-colors hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}
