import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createToastQueue, type QueuedToast, type ToastAction, type ToastKind, type ToastQueue } from './toastQueue';
import './toast.css';

export interface ToastOptions {
  /** Bouton d'action du toast (« Annuler »…) ; le toast se ferme après le clic. */
  action?: ToastAction;
}

interface ToastContextValue {
  success: (message: string, opts?: ToastOptions) => void;
  error: (message: string, opts?: ToastOptions) => void;
  info: (message: string, opts?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_ICONS: Record<ToastKind, string> = { success: '✓', error: '✕', info: 'ℹ' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<QueuedToast[]>([]);
  // File créée une fois (minuteurs, pause) ; elle notifie l'affichage à chaque changement
  const [queue] = useState<ToastQueue>(() => createToastQueue(setToasts));
  // Toasts survolés ou ayant le focus : le décompte ne reprend que quand ni l'un ni l'autre
  const holds = useRef(new Map<number, { hover: boolean; focus: boolean }>());

  useEffect(() => () => queue.dispose(), [queue]);

  const hold = (id: number, kind: 'hover' | 'focus', on: boolean) => {
    const state = holds.current.get(id) ?? { hover: false, focus: false };
    state[kind] = on;
    if (state.hover || state.focus) {
      holds.current.set(id, state);
      queue.pause(id);
    } else {
      holds.current.delete(id);
      queue.resume(id);
    }
  };

  const close = (id: number) => {
    holds.current.delete(id);
    queue.dismiss(id);
  };

  const renderToast = (t: QueuedToast) => (
    <div
      key={t.id}
      className={`toast toast-${t.kind} animate-slide`}
      onMouseEnter={() => hold(t.id, 'hover', true)}
      onMouseLeave={() => hold(t.id, 'hover', false)}
      onFocus={() => hold(t.id, 'focus', true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hold(t.id, 'focus', false);
      }}
    >
      <span className="toast-icon">{TOAST_ICONS[t.kind]}</span>
      <span>{t.message}</span>
      {t.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            close(t.id);
            t.action?.onClick();
          }}
        >
          {t.action.label}
        </button>
      )}
      <button type="button" className="toast-close" aria-label="Fermer" onClick={() => close(t.id)}>
        ✕
      </button>
    </div>
  );

  const value = useMemo<ToastContextValue>(() => ({
    success: (m, opts) => { queue.add('success', m, opts?.action); },
    error: (m, opts) => { queue.add('error', m, opts?.action); },
    info: (m, opts) => { queue.add('info', m, opts?.action); },
  }), [queue]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Erreurs annoncées immédiatement (alert), le reste poliment (status) */}
      <div className="toast-stack">
        <div role="alert" aria-live="assertive" style={{ display: 'contents' }}>
          {toasts.filter((t) => t.kind === 'error').map(renderToast)}
        </div>
        <div role="status" aria-live="polite" style={{ display: 'contents' }}>
          {toasts.filter((t) => t.kind !== 'error').map(renderToast)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé sous <ToastProvider>');
  return ctx;
}
