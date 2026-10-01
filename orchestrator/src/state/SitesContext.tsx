import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchSites } from '../api/sites';
import { ApiError, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { Site } from '../types';

interface SitesContextValue {
  sites: Site[];
  loading: boolean;
  /** Échec du dernier chargement (hors session expirée, gérée globalement) */
  error: string | null;
  refresh: () => Promise<void>;
  getSite: (slug: string) => Site | undefined;
}

const SitesContext = createContext<SitesContextValue | null>(null);

export function SitesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Une réponse tardive (ancien compte, requête dépassée) n'écrase jamais la plus récente
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const data = await fetchSites();
      if (id !== requestId.current) return;
      setSites(data);
      setError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      if (!(err instanceof ApiError && err.status === 401)) {
        setError(errorMessage(err, 'Impossible de charger vos sites.'));
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      setLoading(true);
      refresh();
    } else {
      requestId.current++;
      setSites([]);
      setError(null);
    }
  }, [user, refresh]);

  const value = useMemo<SitesContextValue>(() => ({
    sites,
    loading,
    error,
    refresh,
    getSite: (slug: string) => sites.find((s) => s.slug === slug),
  }), [sites, loading, error, refresh]);

  return <SitesContext.Provider value={value}>{children}</SitesContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSites(): SitesContextValue {
  const ctx = useContext(SitesContext);
  if (!ctx) throw new Error('useSites doit être utilisé sous <SitesProvider>');
  return ctx;
}
