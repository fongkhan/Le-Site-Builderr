import type { HostingMode, Site } from '../types';

// Adresse où consulter un site publié : son vrai domaine en mode cPanel, sinon la copie
// servie par l'orchestrateur (publication simulée).
// La copie suit le dossier réel du site (previewPath, calculé par le serveur).
export function publishedSiteUrl(site: Pick<Site, 'slug' | 'domain' | 'previewPath'>, hostingMode: HostingMode | undefined): string {
  if (hostingMode === 'cpanel' && site.domain) return `https://${site.domain}/`;
  return site.previewPath ?? `/preview/${encodeURIComponent(site.slug)}/`;
}
