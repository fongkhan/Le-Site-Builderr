import { describe, expect, it } from 'vitest';
import { derivePageSlug, isReservedPageSlug, pageAddress, slugifyPageTitle } from './pageSlug';

describe('slugifyPageTitle (aligné sur server/lib/paths.js generateSlug)', () => {
  it.each([
    ['À propos', 'a-propos'],
    ['Nos créations', 'nos-creations'],
    ['Œuvres d’art', 'oeuvres-d-art'],
    ['Cœur de métier', 'coeur-de-metier'],
    ['Ex æquo', 'ex-aequo'],
    ['Straße', 'strasse'],
    ['Ça & là — çà', 'ca-la-ca'],
    ['  --Contact--  ', 'contact'],
    ['Tarifs 2026 !', 'tarifs-2026'],
    ['🎉 Fête', 'fete'],
    ['!!!', ''],
  ])('%s → %s', (title, slug) => {
    expect(slugifyPageTitle(title)).toBe(slug);
  });

  it('respecte le format exigé par le serveur', () => {
    for (const title of ['Été 2026', 'Ñandú', 'Smørrebrød', 'x'.repeat(300)]) {
      const slug = slugifyPageTitle(title);
      expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(slug.length).toBeLessThanOrEqual(80);
      expect(slug.endsWith('-')).toBe(false);
    }
  });
});

describe('derivePageSlug', () => {
  const pages = [
    { slug: 'home', locale: 'fr' },
    { slug: 'contact' }, // sans langue = français
    { slug: 'contact-2', locale: 'fr' },
    { slug: 'home', locale: 'en' },
  ];

  it('déduplique dans la même langue uniquement', () => {
    expect(derivePageSlug('Contact', 'fr', pages)).toEqual({ slug: 'contact-3', error: null });
    expect(derivePageSlug('Contact', 'en', pages)).toEqual({ slug: 'contact', error: null });
    expect(derivePageSlug('Home', 'en', pages)).toEqual({ slug: 'home-2', error: null });
  });

  it('titre sans caractère latin : adresse « page »', () => {
    expect(derivePageSlug('!!!', 'fr', pages)).toEqual({ slug: 'page', error: null });
  });

  it('refuse les adresses réservées', () => {
    for (const title of ['Blog', 'Média', 'EN', 'fr']) {
      const result = derivePageSlug(title, 'fr', pages);
      expect(result.error).toMatch(/réservée/);
    }
    expect(isReservedPageSlug('blog')).toBe(true);
    expect(isReservedPageSlug('blog-actus')).toBe(false);
    expect(derivePageSlug('Blog actus', 'fr', pages).error).toBeNull();
  });
});

describe('pageAddress', () => {
  it('accueil à la racine, anglais sous /en/', () => {
    expect(pageAddress('home')).toBe('/');
    expect(pageAddress('contact', 'fr')).toBe('/contact/');
    expect(pageAddress('home', 'en')).toBe('/en/');
    expect(pageAddress('contact', 'en')).toBe('/en/contact/');
  });
});
