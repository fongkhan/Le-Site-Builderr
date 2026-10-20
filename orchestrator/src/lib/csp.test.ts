import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config';
import { ORCHESTRATOR_CSP, ORCHESTRATOR_CSP_DIRECTIVES } from './csp';

// Directive → sources (« script-src 'self' » → ["'self'"])
const directives = new Map(ORCHESTRATOR_CSP_DIRECTIVES.map((d) => {
  const [name, ...sources] = d.trim().split(/\s+/);
  return [name, sources] as const;
}));

describe('CSP de l’orchestrateur compilé', () => {
  it('politique = directives jointes par « ; », chacune une seule fois', () => {
    expect(ORCHESTRATOR_CSP).toBe(ORCHESTRATOR_CSP_DIRECTIVES.join('; '));
    expect(directives.size).toBe(ORCHESTRATOR_CSP_DIRECTIVES.length);
  });

  it('scripts : uniquement les fichiers de l’application', () => {
    expect(directives.get('script-src')).toEqual(["'self'"]);
    expect(ORCHESTRATOR_CSP).not.toContain("'unsafe-eval'");
    expect(directives.get('default-src')).toEqual(["'self'"]);
  });

  it('ni plugin, ni <base> ni envoi de formulaire étrangers, API de même origine', () => {
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'self'"]);
    expect(directives.get('form-action')).toEqual(["'self'"]);
    expect(directives.get('connect-src')).toEqual(["'self'"]);
  });

  it('polices locales (data: pour les petits woff2 insérés par Vite), aucun hôte Google', () => {
    expect(directives.get('font-src')).toEqual(["'self'", 'data:']);
    expect(ORCHESTRATOR_CSP).not.toMatch(/google|gstatic/i);
  });

  it('images des aperçus : même origine, data:, blob: et adresses web', () => {
    expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https:', 'http:']);
  });

  it('pas de frame-ancestors (ignoré dans une balise <meta>)', () => {
    expect(directives.has('frame-ancestors')).toBe(false);
  });
});

describe('plugin orchestratorCsp (vite.config.ts)', () => {
  it('build seulement : <meta http-equiv="Content-Security-Policy"> en tête de index.html', () => {
    type CspPlugin = { name?: string; apply?: unknown; transformIndexHtml?: () => unknown };
    const plugins = ((viteConfig as { plugins?: unknown[] }).plugins ?? []).flat(Infinity) as CspPlugin[];
    const plugin = plugins.find((p) => p && p.name === 'orchestrator-csp');
    expect(plugin?.apply).toBe('build');
    const transform = plugin?.transformIndexHtml as () => unknown;
    expect(transform()).toEqual([
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: ORCHESTRATOR_CSP }, injectTo: 'head-prepend' },
    ]);
  });
});
