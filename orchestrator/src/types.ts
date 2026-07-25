// Types partagés de l'orchestrateur

export interface FeatureFlags {
  blog_or_news: boolean;
  e_commerce: boolean;
  multi_store: boolean;
}

export interface StackRequirements {
  astro_mode: string;
  need_payload: boolean;
  need_medusajs: boolean;
  need_stripe: boolean;
}

export interface OnboardingResult {
  site_name: string;
  features: FeatureFlags;
  stack_requirements: StackRequirements;
}

export interface Theme {
  colors: {
    primary: string;
    secondary: string;
    background: string;
    text: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  radius: string;
}

export interface Block {
  blockType: string;
  title?: string;
  subtitle?: string;
  ctaText?: string;
  backgroundImage?: string;
  items?: { title?: string; description?: string; question?: string; answer?: string }[];
  products?: { name: string; price: string; image: string }[];
  images?: string[];
  testimonials?: { quote: string; author: string; role: string; avatar: string; rating?: number }[];
  plans?: {
    name: string;
    price: string;
    description: string;
    features: { feature: string }[];
    ctaText: string;
    isPopular: boolean;
  }[];
  // Bloc appointment (demande de rendez-vous)
  services?: { name: string }[];
  // Bloc info (infos pratiques)
  address?: string;
  phone?: string;
  email?: string;
  hours?: string;
  googleBusinessUrl?: string;
  // Bloc footer
  text?: string;
  socials?: { facebook?: string; instagram?: string; linkedin?: string; x?: string };
}

export interface PageDoc {
  title: string;
  slug: string;
  /** Langue de la page : 'fr' (racine) ou 'en' (servie sous /en/). */
  locale?: string;
  metaTitle?: string;
  metaDescription?: string;
  layout: Block[];
}

export interface PagesData {
  docs: PageDoc[];
}

export interface Site {
  slug: string;
  name: string;
  domain: string;
  documentRoot: string;
  repositoryPath: string;
  stack: string;
  createdWithTool: boolean;
  status: 'draft' | 'active' | 'error' | string;
  sslStatus: string;
  // Domaine personnalisé (rattachement du vrai nom de domaine du client)
  customDomain?: string;
  domainStatus?: 'none' | 'pending' | 'active' | 'error' | string;
  domainVerifyToken?: string;
  // Mesure d'audience (chargée après consentement RGPD sur le site publié)
  analyticsProvider?: '' | 'ga4' | 'matomo' | string;
  analyticsId?: string;
  analyticsHost?: string;
}

export interface ScannedSite {
  slug: string;
  name: string;
  documentRoot: string;
  repositoryPath: string;
  domain: string;
  stack: string;
}

export interface BuildStatus {
  inProgress: boolean;
  status: string;
  lastCompleted: string | null;
  error: string | null;
  lockExists: boolean;
  logs: string;
  buildingSite?: string | null;
  /** Slugs en attente, dans l'ordre (admins uniquement) */
  queue?: string[];
  queueLength?: number;
  /** Positions des sites de l'utilisateur courant dans la file (clients) */
  queuedSites?: { slug: string; position: number }[];
}

export interface RebuildResponse {
  message: string;
  queued?: boolean;
  position?: number;
  alreadyBuilding?: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  mtime?: string;
}

export type AiProvider = 'openai' | 'anthropic' | 'gemini';

export interface AiQuotaInfo {
  limit: number;
  used: number;
  remaining: number;
}

export interface AppConfig {
  availableProviders: Record<AiProvider, boolean>;
  defaultProvider: AiProvider;
  devNoAuth?: boolean;
  /** null = illimité (admin) */
  aiQuota?: AiQuotaInfo | null;
  /** Offre du compte : null = sans limite (admin). */
  plan?: PlanInfo | null;
}

export interface PlanInfo {
  plan: string;
  label: string;
  maxSites: number;
  aiDailyQuota: number;
  sitesUsed: number;
}

export interface User {
  id: string | number;
  email: string;
  roles: ('admin' | 'client')[];
  sites?: (Site | number | string)[];
}

export const DEFAULT_THEME: Theme = {
  colors: { primary: '#8b5a2b', secondary: '#f5e6cc', background: '#fafafa', text: '#2d241e' },
  fonts: { heading: 'Playfair Display', body: 'Inter' },
  radius: '12px',
};
