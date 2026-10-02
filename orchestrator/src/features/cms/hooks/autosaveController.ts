import { ApiError, errorMessage } from '../../../api/client';

// Machine d'état de la sauvegarde automatique, sans React ni DOM (testable avec de faux
// minuteurs). Chaque enregistrement envoie le document COMPLET : la dernière version en
// attente remplace donc toujours les précédentes.
//
// - schedule(data) : enregistrement débouncé (frappe au clavier) ;
// - saveNow(data)  : enregistrement immédiat (ajout, suppression, déplacement) ;
// - une seule requête en vol ; à son retour, on ne relance que si une nouvelle édition
//   est arrivée entre-temps ;
// - erreur réseau / 5xx / 408 / 429 : nouvel essai avec attente exponentielle plafonnée ;
// - autre erreur 4xx (corps refusé, droits…) : ARRÊT des essais automatiques (statut
//   « error ») jusqu'à retry() ou une nouvelle édition ;
// - dispose() : envoie une dernière fois ce qui attend (démontage), sans nouvel essai.

export type AutosaveStatus =
  | 'idle' // tout est enregistré
  | 'pending' // modification en attente (débounce)
  | 'saving' // requête en vol
  | 'retrying' // échec temporaire, nouvel essai programmé
  | 'error'; // refus définitif, essais automatiques arrêtés

export interface AutosaveState {
  status: AutosaveStatus;
  /** Message du dernier échec ; effacé au premier enregistrement réussi */
  error: string | null;
  /** Délai avant le prochain essai automatique (statut « retrying » uniquement) */
  retryInMs: number | null;
  /** Échecs consécutifs */
  failures: number;
}

export const INITIAL_AUTOSAVE_STATE: AutosaveState = { status: 'idle', error: null, retryInMs: null, failures: 0 };

export interface AutosaveErrorInfo {
  /** true : plus aucun essai automatique */
  permanent: boolean;
  failures: number;
  retryInMs: number | null;
}

export interface AutosaveOptions<T> {
  save: (data: T) => Promise<unknown>;
  debounceMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  isPermanentError?: (err: unknown) => boolean;
  onStateChange?: (state: AutosaveState) => void;
  onError?: (err: unknown, info: AutosaveErrorInfo) => void;
}

export interface AutosaveController<T> {
  schedule: (data: T) => void;
  saveNow: (data: T) => void;
  /** Envoie tout de suite ce qui attend (y compris après un refus définitif) */
  retry: () => void;
  dispose: () => void;
  getState: () => AutosaveState;
}

export const AUTOSAVE_DEBOUNCE_MS = 500;
export const AUTOSAVE_RETRY_BASE_MS = 1000;
export const AUTOSAVE_RETRY_MAX_MS = 30_000;

// 4xx = le serveur refuse ce contenu : réessayer à l'identique ne sert à rien.
// Exceptions transitoires : 408 (délai dépassé) et 429 (trop de requêtes).
export function isPermanentSaveError(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429;
}

export function retryDelay(failures: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, failures - 1));
}

export function createAutosave<T>(options: AutosaveOptions<T>): AutosaveController<T> {
  const {
    save,
    debounceMs = AUTOSAVE_DEBOUNCE_MS,
    retryBaseMs = AUTOSAVE_RETRY_BASE_MS,
    retryMaxMs = AUTOSAVE_RETRY_MAX_MS,
    isPermanentError = isPermanentSaveError,
    onStateChange,
    onError,
  } = options;

  let pending: { data: T } | null = null; // dernière version non enregistrée
  let due = false; // la version en attente doit partir dès que possible
  let inFlight = false;
  let blocked = false; // refus définitif : plus d'essai automatique
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerKind: 'debounce' | 'retry' | null = null;
  let failures = 0;
  let error: string | null = null;
  let retryInMs: number | null = null;
  let state = INITIAL_AUTOSAVE_STATE;

  const status = (): AutosaveStatus => {
    if (inFlight) return 'saving';
    if (blocked) return 'error';
    if (timerKind === 'retry') return 'retrying';
    if (pending) return 'pending';
    return 'idle';
  };

  const emit = () => {
    const next: AutosaveState = { status: status(), error, retryInMs: timerKind === 'retry' ? retryInMs : null, failures };
    if (next.status === state.status && next.error === state.error && next.retryInMs === state.retryInMs && next.failures === state.failures) return;
    state = next;
    onStateChange?.(next);
  };

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    timerKind = null;
  };

  const startTimer = (kind: 'debounce' | 'retry', ms: number) => {
    clearTimer();
    timerKind = kind;
    timer = setTimeout(() => {
      timer = null;
      timerKind = null;
      due = true;
      pump();
      emit();
    }, ms);
  };

  // Lance la requête si une version est due et qu'aucune n'est en vol.
  const pump = () => {
    if (inFlight || !pending || !due) return;
    const { data } = pending;
    pending = null;
    due = false;
    inFlight = true;
    clearTimer();
    emit();
    let request: Promise<unknown>;
    try {
      request = Promise.resolve(save(data));
    } catch (err) {
      request = Promise.reject(err);
    }
    request.then(
      () => onSuccess(),
      (err: unknown) => onFailure(data, err),
    );
  };

  const onSuccess = () => {
    inFlight = false;
    failures = 0;
    error = null;
    retryInMs = null;
    // Une édition arrivée pendant la requête part à la fin de son débounce (ou tout de
    // suite si elle était déjà due) ; après le démontage, sans attendre.
    if (pending && disposed) due = true;
    pump();
    emit();
  };

  const onFailure = (data: T, err: unknown) => {
    inFlight = false;
    const newerEdit = pending !== null;
    if (!newerEdit) pending = { data }; // la version refusée reste à enregistrer
    failures += 1;
    error = errorMessage(err, "Erreur lors de l'enregistrement.");
    const permanent = isPermanentError(err);
    if (permanent) {
      retryInMs = null;
      if (newerEdit) {
        // L'édition plus récente (peut-être la correction) suit son cours normal ;
        // après le démontage, elle part tout de suite (une seule fois).
        if (disposed) due = true;
        pump();
      } else {
        blocked = true;
        clearTimer();
      }
    } else if (disposed) {
      retryInMs = null; // démonté : pas de nouvel essai
    } else {
      retryInMs = retryDelay(failures, retryBaseMs, retryMaxMs);
      due = false;
      startTimer('retry', retryInMs);
    }
    emit();
    onError?.(err, { permanent, failures, retryInMs });
  };

  return {
    schedule(data) {
      pending = { data };
      blocked = false;
      if (disposed) {
        due = true;
        pump();
      } else if (timerKind !== 'retry') {
        // L'attente d'un nouvel essai reste prioritaire : on ne martèle pas un serveur en panne.
        startTimer('debounce', debounceMs);
      }
      emit();
    },
    saveNow(data) {
      pending = { data };
      blocked = false;
      clearTimer();
      due = true;
      pump();
      emit();
    },
    retry() {
      if (!pending) return;
      blocked = false;
      clearTimer();
      due = true;
      pump();
      emit();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimer();
      if (pending && !blocked) {
        due = true;
        pump();
      }
      emit();
    },
    getState: () => state,
  };
}
