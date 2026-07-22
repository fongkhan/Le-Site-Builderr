import { apiFetch } from './client';

export type AssistAction = 'rewrite' | 'generate-description' | 'seo' | 'article';

// Assistant IA du CMS (auth + ownership + quota côté serveur).
// rewrite/generate-description → { text } ; seo → { metaTitle, metaDescription } ;
// article → { title, excerpt, body }.
export function aiAssist(
  site: string,
  action: AssistAction,
  input: string,
  context?: string
): Promise<{ text?: string; metaTitle?: string; metaDescription?: string; title?: string; excerpt?: string; body?: string }> {
  return apiFetch('/api/ai/assist', {
    method: 'POST',
    body: JSON.stringify({ site, action, input, context }),
  });
}
