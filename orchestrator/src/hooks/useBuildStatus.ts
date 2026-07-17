import { useEffect, useState } from 'react';
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

// Polling du statut de build toutes les 2s — uniquement quand une session est active
export function useBuildStatus(): BuildStatus {
  const { user } = useAuth();
  const [status, setStatus] = useState<BuildStatus>(IDLE_STATUS);

  useEffect(() => {
    if (!user) {
      setStatus(IDLE_STATUS);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await fetchBuildStatus();
        if (!cancelled) setStatus(data);
      } catch {
        // serveur indisponible ou session expirée : on garde le dernier état connu
      }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user]);

  return status;
}
