import type { HostingMode, Site } from '../types';

// Adresse où consulter un site publié : son vrai domaine en mode cPanel, sinon la copie
// servie par l'orchestrateur (publication simulée).
export function publishedSiteUrl(site: Pick<Site, 'slug' | 'domain'>, hostingMode: HostingMode | undefined): string {
  if (hostingMode === 'cpanel' && site.domain) return `https://${site.domain}/`;
  return `/preview/${encodeURIComponent(site.slug)}/`;
}
