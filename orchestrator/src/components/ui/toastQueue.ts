// File des notifications (toasts) — sans React. Chaque toast expire après une durée
// propre à son type ; le survol ou le focus le met en pause (temps restant conservé),
// pour laisser le temps de lire ou d'utiliser son action (« Annuler »…).

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface QueuedToast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

/** Nombre maximal de toasts affichés : les plus anciens cèdent la place. */
export const MAX_TOASTS = 4;

/** Erreurs : 12 s (le temps de les lire) ; succès et informations : 5 s. */
export function durationFor(kind: ToastKind): number {
  return kind === 'error' ? 12_000 : 5_000;
}

interface Entry {
  toast: QueuedToast;
  /** Temps restant avant expiration (ms) */
  remaining: number;
  /** Début du décompte en cours, ou null si en pause */
  startedAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface ToastQueue {
  add: (kind: ToastKind, message: string, action?: ToastAction, now?: number) => number;
  dismiss: (id: number) => void;
  pause: (id: number, now?: number) => void;
  resume: (id: number, now?: number) => void;
  /** Temps restant d'un toast (ms), ou null s'il n'existe plus */
  remaining: (id: number, now?: number) => number | null;
  list: () => QueuedToast[];
  /** Arrête tous les minuteurs (démontage) */
  dispose: () => void;
}

export function createToastQueue(onChange: (toasts: QueuedToast[]) => void, max = MAX_TOASTS): ToastQueue {
  let entries: Entry[] = [];
  let nextId = 1;

  const list = () => entries.map((e) => e.toast);
  const notify = () => onChange(list());
  const find = (id: number) => entries.find((e) => e.toast.id === id);

  const stop = (entry: Entry) => {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
  };

  const dismiss = (id: number) => {
    const entry = find(id);
    if (!entry) return;
    stop(entry);
    entries = entries.filter((e) => e !== entry);
    notify();
  };

  const start = (entry: Entry, now: number) => {
    stop(entry);
    entry.startedAt = now;
    entry.timer = setTimeout(() => dismiss(entry.toast.id), Math.max(0, entry.remaining));
  };

  return {
    add(kind, message, action, now = Date.now()) {
      const toast: QueuedToast = { id: nextId++, kind, message, ...(action ? { action } : {}) };
      const entry: Entry = { toast, remaining: durationFor(kind), startedAt: null, timer: null };
      entries = [...entries, entry];
      // Pile bornée : les plus anciens disparaissent
      while (entries.length > max) {
        stop(entries[0]);
        entries = entries.slice(1);
      }
      start(entry, now);
      notify();
      return toast.id;
    },
    dismiss,
    pause(id, now = Date.now()) {
      const entry = find(id);
      if (!entry || entry.startedAt === null) return;
      entry.remaining -= now - entry.startedAt;
      entry.startedAt = null;
      stop(entry);
    },
    resume(id, now = Date.now()) {
      const entry = find(id);
      if (!entry || entry.startedAt !== null) return;
      start(entry, now);
    },
    remaining(id, now = Date.now()) {
      const entry = find(id);
      if (!entry) return null;
      return entry.startedAt === null ? entry.remaining : entry.remaining - (now - entry.startedAt);
    },
    list,
    dispose() {
      for (const entry of entries) stop(entry);
      entries = [];
    },
  };
}
