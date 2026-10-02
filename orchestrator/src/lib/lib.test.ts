/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatBytes, formatDateFr } from './format';
import { contrastRatio, isHexColor, toHex6, withAlpha } from './color';
import { publishedSiteUrl } from './siteUrls';
import { routeTitle } from './routeTitle';
import { sitePath, errorMessage, ApiError, apiFetch, NETWORK_ERROR_MESSAGE } from '../api/client';

// Feuille de style globale lue telle quelle (Vitest neutralise les imports CSS)
const indexCss = readFileSync(new URL('../index.css', import.meta.url), 'utf-8');

describe('format', () => {
  it('date seule lue en heure locale (jamais la veille)', () => {
    expect(formatDateFr('2026-03-01')).toBe(new Date(2026, 2, 1).toLocaleDateString('fr-FR'));
    expect(formatDateFr('')).toBe('');
    expect(formatDateFr('pas une date')).toBe('');
  });
  it('tailles lisibles', () => {
    expect(formatBytes(512)).toBe('512 o');
    expect(formatBytes(2048)).toBe('2 Ko');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 Mo');
  });
});

describe('color', () => {
  it('normalise #RGB et #RRGGBBAA', () => {
    expect(toHex6('#abc')).toBe('#aabbcc');
    expect(toHex6('#11223344')).toBe('#112233');
    expect(toHex6('rouge')).toBe('#000000');
    expect(isHexColor('#12345')).toBe(false);
  });
  it('ajoute un canal alpha valide quel que soit le format', () => {
    expect(withAlpha('#abc', 0.5)).toBe('#aabbcc80');
    expect(withAlpha('#11223344', 0)).toBe('#11223300');
    expect(withAlpha('#112233', 2)).toBe('#112233ff');
  });
});

describe('siteUrls', () => {
  it('vrai domaine en mode cPanel, copie locale sinon', () => {
    expect(publishedSiteUrl({ slug: 'mon-site', domain: 'mon-site.fr' }, 'cpanel')).toBe('https://mon-site.fr/');
    expect(publishedSiteUrl({ slug: 'mon-site', domain: 'mon-site.fr' }, 'simulation')).toBe('/preview/mon-site/');
    expect(publishedSiteUrl({ slug: 'mon-site', domain: 'x.fr' }, undefined)).toBe('/preview/mon-site/');
    expect(publishedSiteUrl({ slug: 'site-client', domain: 'x.fr', previewPath: '/preview/Site_Client/' }, 'simulation')).toBe('/preview/Site_Client/');
  });
});

describe('api/client', () => {
  it('sitePath encode le slug et les segments', () => {
    expect(sitePath('mon-site', 'custom-domain', 'verify')).toBe('/api/sites/mon-site/custom-domain/verify');
    expect(sitePath('a/b')).toBe('/api/sites/a%2Fb');
  });
  it('errorMessage', () => {
    expect(errorMessage(new ApiError(400, 'Invalide'), 'repli')).toBe('Invalide');
    expect(errorMessage('x', 'repli')).toBe('repli');
  });
});

describe('apiFetch : erreurs réseau et réponses non JSON', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (err) {
      return err;
    }
    throw new Error('la requête aurait dû échouer');
  };

  it('serveur injoignable (TypeError) : statut 0 et message en français', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await failure(apiFetch('/api/sites'));
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).message).toBe(NETWORK_ERROR_MESSAGE);
    expect(NETWORK_ERROR_MESSAGE).toMatch(/Serveur injoignable/);
  });

  it('502 en texte : message « indisponible »', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 })));
    const err = await failure(apiFetch('/api/sites'));
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).message).toMatch(/indisponible/);
  });

  it('413 et 429 en texte : messages dédiés ; le message JSON du serveur prime', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('trop gros', { status: 413 })));
    expect(((await failure(apiFetch('/x'))) as ApiError).message).toBe('Fichier ou contenu trop volumineux');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    expect(((await failure(apiFetch('/x'))) as ApiError).message).toBe('Trop de requêtes, réessayez dans un instant');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Quota IA atteint.' }), { status: 429 })));
    expect(((await failure(apiFetch('/x'))) as ApiError).message).toBe('Quota IA atteint.');
  });

  it('AbortError propagée telle quelle', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    const err = await failure(apiFetch('/api/sites'));
    expect(err).toBe(abort);
    expect(err).not.toBeInstanceOf(ApiError);
  });
});

describe('routeTitle', () => {
  it('pages principales', () => {
    expect(routeTitle('/sites')).toBe('Mes sites · Le Site Builder');
    expect(routeTitle('/admin-panel')).toBe('Panel Admin · Le Site Builder');
  });
  it('pages d’un site, avec ou sans nom connu', () => {
    expect(routeTitle('/sites/x/cms', 'Boulangerie')).toBe('Contenu — Boulangerie · Le Site Builder');
    expect(routeTitle('/sites/x/messages', 'Boulangerie')).toBe('Messages — Boulangerie · Le Site Builder');
    expect(routeTitle('/sites/x/cms/')).toBe('Contenu — x · Le Site Builder');
  });
  it('404', () => {
    expect(routeTitle('/nulle-part')).toBe('Page introuvable · Le Site Builder');
    expect(routeTitle('/sites/x/inconnu', 'Boulangerie')).toBe('Page introuvable · Le Site Builder');
  });
});

describe('accessibilité : styles globaux', () => {
  it('règle :focus-visible sans « outline: none »', () => {
    const rules = [...indexCss.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    const generic = rules.find(([, selector]) => selector.includes(':where('));
    expect(generic?.[2]).toMatch(/outline:\s*2px solid var\(--accent-blue\)/);
    for (const [, , body] of rules) expect(body).not.toMatch(/outline:\s*none/);
  });
  it('bloc prefers-reduced-motion, spinner ralenti mais pas figé', () => {
    const block = indexCss.slice(indexCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block.length).toBeGreaterThan(40);
    expect(block).toMatch(/\.spinner\s*\{[^}]*animation-iteration-count:\s*infinite/);
  });
  it('contraste --accent-blue / --bg-dark ≥ 3:1', () => {
    const token = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(indexCss)?.[1] ?? '';
    const accent = token('--accent-blue');
    const bg = token('--bg-dark');
    expect(isHexColor(accent) && isHexColor(bg)).toBe(true);
    expect(contrastRatio(accent, bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });
});
