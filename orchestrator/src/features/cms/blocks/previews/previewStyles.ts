import type { CSSProperties } from 'react';
import type { Theme } from '../../../../types';

// Styles communs des aperçus (reproduisent le rendu du template Astro).

export function headingStyle(theme: Theme): CSSProperties {
  return { textAlign: 'center', marginBottom: 30, fontFamily: `'${theme.fonts.heading}', serif`, color: theme.colors.text };
}

export const SECTION_STYLE: CSSProperties = { padding: '40px 20px' };

export function cardStyle(theme: Theme): CSSProperties {
  return { background: '#ffffff', border: '1px solid rgba(0,0,0,0.05)', borderRadius: theme.radius };
}

export function formFieldStyle(theme: Theme): CSSProperties {
  return { padding: 10, borderRadius: theme.radius, border: '1px solid rgba(0,0,0,0.15)', font: 'inherit' };
}

// Valeur CSS url("…") sûre (guillemets et antislashs échappés).
export function cssUrl(url: string): string {
  return `url(${JSON.stringify(url)})`;
}
