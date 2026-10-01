import { describe, expect, it } from 'vitest';
import { formatBytes, formatDateFr } from './format';
import { isHexColor, toHex6, withAlpha } from './color';
import { publishedSiteUrl } from './siteUrls';
import { sitePath, errorMessage, ApiError } from '../api/client';

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
