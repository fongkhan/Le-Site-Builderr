import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchConfig } from '../api/onboarding';
import { useAuth } from '../auth/AuthContext';
import type { AppConfig } from '../types';

interface ConfigContextValue {
  /** null tant que la configuration n'est pas chargée */
  config: AppConfig | null;
  refresh: () => Promise<void>;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

// Configuration du compte (fournisseurs IA, quota, offre, mode d'hébergement) chargée une
// seule fois après connexion et partagée ; refresh() après une génération IA.
export function ConfigProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const data = await fetchConfig();
      if (id === requestId.current) setConfig(data);
    } catch {
      // erreur réseau : on garde la dernière configuration connue
    }
  }, []);

  useEffect(() => {
    if (user) {
      refresh();
    } else {
      requestId.current++;
      setConfig(null);
    }
  }, [user, refresh]);

  const value = useMemo(() => ({ config, refresh }), [config, refresh]);
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig doit être utilisé sous <ConfigProvider>');
  return ctx;
}
