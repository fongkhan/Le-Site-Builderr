import { useOutletContext } from 'react-router-dom';
import type { Site } from '../types';

// Contexte transmis par SiteLayout à ses pages (design, contenu, blog, déploiement).
export interface SiteOutletContext {
  site: Site;
}

export function useCurrentSite(): Site {
  return useOutletContext<SiteOutletContext>().site;
}
