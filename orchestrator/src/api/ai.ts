import { apiFetch } from './client';

export type AssistAction = 'rewrite' | 'generate-description' | 'seo';

// Assistant IA du CMS (auth + ownership + quota côté serveur).
// rewrite/generate-description → { text } ; seo → { metaTitle, metaDescription }.
export function aiAssist(
  site: string,
  action: AssistAction,
  input: string,
  context?: string
): Promise<{ text?: string; metaTitle?: string; metaDescription?: string }> {
  return apiFetch('/api/ai/assist', {
    method: 'POST',
    body: JSON.stringify({ site, action, input, context }),
  });
}
