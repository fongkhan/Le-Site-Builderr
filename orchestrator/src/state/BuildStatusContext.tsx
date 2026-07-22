import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { fetchBuildStatus } from '../api/sites';
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

const BuildStatusContext = createContext<BuildStatus>(IDLE_STATUS);

// Un SEUL poller partagé pour toute l'app (avant : chaque consommateur créait son
// propre setInterval 2s → N requêtes/2s). Backoff adaptatif + pause onglet caché.
export function BuildStatusProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<BuildStatus>(IDLE_STATUS);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) {
      setStatus(IDLE_STATUS);
      return;
    }
    let cancelled = false;

    const poll = async () => {
      let next = IDLE_MS;
      try {
        const data = await fetchBuildStatus();
        if (cancelled) return;
        setStatus(data);
        next = data.inProgress || (data.queueLength ?? 0) > 0 ? ACTIVE_MS : IDLE_MS;
      } catch {
        // serveur indisponible / session expirée : garder le dernier état, re-tenter au rythme lent
      }
      if (!cancelled) timer.current = setTimeout(poll, next);
    };

    // Reprise immédiate au retour sur l'onglet (le polling ne s'arrête pas mais on
    // rafraîchit sans attendre le prochain tick).
    const onVisible = () => {
      if (document.hidden || cancelled) return;
      if (timer.current) clearTimeout(timer.current);
      poll();
    };

    poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  return <BuildStatusContext.Provider value={status}>{children}</BuildStatusContext.Provider>;
}

// Signature inchangée : renvoie le BuildStatus courant partagé.
// eslint-disable-next-line react-refresh/only-export-components
export function useBuildStatus(): BuildStatus {
  return useContext(BuildStatusContext);
}
