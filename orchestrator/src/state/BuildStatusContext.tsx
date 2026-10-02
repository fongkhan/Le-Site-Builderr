import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchBuildStatus } from '../api/deploy';
import { useAuth } from '../auth/AuthContext';
import type { BuildStatus } from '../types';

const IDLE_STATUS: BuildStatus = {
  inProgress: false,
  status: 'idle',
  lastCompleted: null,
  error: null,
  lockExists: false,
  logs: '',
  buildingSite: null,
  queue: [],
  queueLength: 0,
  queuedSites: [],
};

// Cadence adaptative : rapide quand un build/une file est actif, lente au repos.
const ACTIVE_MS = 2000;
const IDLE_MS = 12000;

interface BuildStatusContextValue {
  status: BuildStatus;
  /** Sonde immédiatement (ex. juste après avoir lancé un build) */
  refresh: () => void;
}

const BuildStatusContext = createContext<BuildStatusContextValue>({ status: IDLE_STATUS, refresh: () => {} });

// Un SEUL poller partagé pour toute l'app. Une seule chaîne de requêtes à la fois :
// un sondage demandé pendant une requête en vol est simplement relancé à sa fin
// (jamais deux boucles concurrentes). Pause quand l'onglet est caché.
export function BuildStatusProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<BuildStatus>(IDLE_STATUS);
  const pollRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!user) {
      setStatus(IDLE_STATUS);
      pollRef.current = () => {};
      return;
    }
    let cancelled = false;
    let inFlight = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(poll, ms);
    };

    async function poll() {
      if (cancelled) return;
      if (inFlight) {
        pending = true;
        return;
      }
      if (timer) clearTimeout(timer);
      timer = null;
      if (document.hidden) return; // reprise au retour sur l'onglet
      inFlight = true;
      let next = IDLE_MS;
      try {
        const data = await fetchBuildStatus();
        if (cancelled) return;
        setStatus(data);
        next = data.inProgress || (data.queueLength ?? 0) > 0 ? ACTIVE_MS : IDLE_MS;
      } catch {
        // serveur indisponible / session expirée : garder le dernier état, re-tenter au rythme lent
      } finally {
        inFlight = false;
      }
      if (cancelled) return;
      if (pending) {
        pending = false;
        poll();
      } else {
        schedule(next);
      }
    }

    const onVisible = () => {
      if (!document.hidden) poll();
    };

    pollRef.current = poll;
    poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      pollRef.current = () => {};
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  const refresh = useCallback(() => pollRef.current(), []);
  const value = useMemo(() => ({ status, refresh }), [status, refresh]);
  return <BuildStatusContext.Provider value={value}>{children}</BuildStatusContext.Provider>;
}

// Renvoie le BuildStatus courant partagé.
// eslint-disable-next-line react-refresh/only-export-components
export function useBuildStatus(): BuildStatus {
  return useContext(BuildStatusContext).status;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRefreshBuildStatus(): () => void {
  return useContext(BuildStatusContext).refresh;
}
