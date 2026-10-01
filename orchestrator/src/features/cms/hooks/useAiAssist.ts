import { useCallback } from 'react';
import { aiAssist, preferredProvider, type AssistAction } from '../../../api/ai';
import { useConfig } from '../../../state/ConfigContext';

// Assistant IA du CMS : fournisseur préféré du compte, quota rafraîchi après chaque
// génération, et raison d'indisponibilité à afficher (bouton désactivé).
export function useAiAssist(siteSlug: string) {
  const { config, refresh } = useConfig();
  const provider = preferredProvider(config);

  let disabledReason: string | null = null;
  if (config && !provider) disabledReason = "Aucun fournisseur d'IA n'est configuré.";
  else if (config?.aiQuota && config.aiQuota.remaining <= 0) disabledReason = "Quota quotidien d'IA atteint : réessayez demain.";

  const run = useCallback(
    async (action: AssistAction, input: string, context?: string) => {
      try {
        return await aiAssist(siteSlug, action, input, context, provider);
      } finally {
        void refresh(); // quota consommé (ou refusé) : mise à jour de l'affichage
      }
    },
    [siteSlug, provider, refresh],
  );

  return { run, disabledReason };
}
