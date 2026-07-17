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
  testimonials?: { quote: string; author: string; role: string; avatar: string }[];
  plans?: {
    name: string;
    price: string;
    description: string;
    features: { feature: string }[];
    ctaText: string;
    isPopular: boolean;
  }[];
}

export interface PageDoc {
  title: string;
  slug: string;
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
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  mtime?: string;
}

export type AiProvider = 'openai' | 'anthropic' | 'gemini';

export interface AppConfig {
  availableProviders: Record<AiProvider, boolean>;
  defaultProvider: AiProvider;
  devNoAuth?: boolean;
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
