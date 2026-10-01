import { apiFetch } from './client';
import type { AiProvider, AppConfig } from '../types';

export type AssistAction = 'rewrite' | 'generate-description' | 'seo' | 'article';

// Assistant IA du CMS (auth + ownership + quota côté serveur).
// rewrite/generate-description → { text } ; seo → { metaTitle, metaDescription } ;
// article → { title, excerpt, body }.
export function aiAssist(
  site: string,
  action: AssistAction,
  input: string,
  context?: string,
  provider?: AiProvider
): Promise<{ text?: string; metaTitle?: string; metaDescription?: string; title?: string; excerpt?: string; body?: string }> {
  return apiFetch('/api/ai/assist', {
    method: 'POST',
    body: JSON.stringify({ site, action, input, context, provider }),
  });
}

// Fournisseur IA à utiliser : celui par défaut s'il est configuré, sinon le premier
// disponible (undefined → le serveur applique son propre défaut).
export function preferredProvider(config: AppConfig | null | undefined): AiProvider | undefined {
  if (!config) return undefined;
  const available = (Object.keys(config.availableProviders) as AiProvider[]).filter((p) => config.availableProviders[p]);
  if (available.includes(config.defaultProvider)) return config.defaultProvider;
  return available[0];
}
