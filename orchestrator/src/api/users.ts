import { apiFetch } from './client';

export interface CreateClientInput {
  email: string;
  password: string;
  siteSlugs: string[];
  aiDailyQuota?: number | null;
}

// Résout des slugs de sites en IDs Payload (la relation users.sites attend des IDs,
// jamais des slugs). Requête REST Payload sur payload_sites.
export async function resolveSiteIds(slugs: string[]): Promise<Array<string | number>> {
  if (slugs.length === 0) return [];
  const query = `where[slug][in]=${encodeURIComponent(slugs.join(','))}&limit=200&depth=0`;
  const res = await apiFetch<{ docs: Array<{ id: string | number; slug: string }> }>(`/api/payload_sites?${query}`);
  const bySlug = new Map(res.docs.map((d) => [d.slug, d.id]));
  const missing = slugs.filter((s) => !bySlug.has(s));
  if (missing.length > 0) {
    throw new Error(`Site(s) introuvable(s) : ${missing.join(', ')}`);
  }
  return slugs.map((s) => bySlug.get(s)!);
}

// Crée un compte client via l'API REST Payload (POST /api/users). Réservé aux admins
// (access.create = isAdmin côté Payload). Le cookie et l'Origin sont déjà légitimes.
export async function createClient({ email, password, siteSlugs, aiDailyQuota }: CreateClientInput): Promise<void> {
  const sites = await resolveSiteIds(siteSlugs);
  const body: Record<string, unknown> = { email, password, roles: ['client'], sites };
  if (aiDailyQuota !== null && aiDailyQuota !== undefined) body.aiDailyQuota = aiDailyQuota;
  await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(body) });
}
