import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchSites } from '../api/sites';
import { useAuth } from '../auth/AuthContext';
import type { Site } from '../types';

interface SitesContextValue {
  sites: Site[];
  loading: boolean;
  refresh: () => Promise<void>;
  getSite: (slug: string) => Site | undefined;
}

const SitesContext = createContext<SitesContextValue | null>(null);

export function SitesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchSites();
      setSites(data);
    } catch {
      // les erreurs d'auth sont gérées globalement (redirection login)
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      setLoading(true);
      refresh();
    } else {
      setSites([]);
    }
  }, [user, refresh]);

  const value = useMemo<SitesContextValue>(() => ({
    sites,
    loading,
    refresh,
    getSite: (slug: string) => sites.find((s) => s.slug === slug),
  }), [sites, loading, refresh]);

  return <SitesContext.Provider value={value}>{children}</SitesContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSites(): SitesContextValue {
  const ctx = useContext(SitesContext);
  if (!ctx) throw new Error('useSites doit être utilisé sous <SitesProvider>');
  return ctx;
}
