import { describe, expect, it } from 'vitest';
import type { PageDoc } from '../../../types';
import { isBlogArticlePath, isValidEmail, isValidTel, isValidWebUrl, linkHint, linkMode, linkTargetsFor, normalizePagePath, type LinkTargets } from './ctaLink';

const page = (slug: string, locale: string, blockTypes: string[] = [], title = slug): PageDoc => ({
  title,
  slug,
  locale,
  layout: blockTypes.map((blockType) => ({ blockType })),
});

const frHome = page('home', 'fr', ['hero', 'contact'], 'Accueil');
const frTarifs = page('tarifs', 'fr', ['pricing'], 'Tarifs');
const enHome = page('home', 'en', ['hero'], 'Home');
const PAGES = [frHome, frTarifs, enHome];

describe('linkMode', () => {
  it.each([
    [undefined, 'auto'],
    [null, 'auto'],
    ['', 'auto'],
    ['  ', 'auto'],
    ['#contact', 'anchor'],
    ['/cours/', 'page'],
    ['tel:1', 'tel'],
    ['TEL:+33 4', 'tel'],
    ['MAILTO:x', 'email'],
    ['https://', 'web'],
    ['www.x.fr', 'web'],
    ['javascript:alert(1)', 'web'],
  ] as const)('%j → %s', (value, mode) => {
    expect(linkMode(value)).toBe(mode);
  });
});

describe('syntaxe des liens (mêmes règles que le template)', () => {
  it('chemins de page : normalisés, jamais //, \\, .., ? ni #', () => {
    expect(normalizePagePath('/')).toBe('/');
    expect(normalizePagePath('/cours')).toBe('/cours/');
    expect(normalizePagePath(' /en/about/ ')).toBe('/en/about/');
    for (const bad of ['//evil.com', '/\\evil', '/cours/../x', '/cours?x=1', '/cours/#contact', '/a//b/', 'cours']) {
      expect(normalizePagePath(bad), bad).toBeNull();
    }
  });

  it('article du blog : /blog/<slug>/ (barre finale facultative), ni l’index ni plus profond', () => {
    for (const ok of ['/blog/mon-article/', '/blog/mon-article', ' /blog/a_1/ ']) expect(isBlogArticlePath(ok), ok).toBe(true);
    for (const bad of ['/blog/', '/blog', '/blog/a/b/', '/en/blog/a/', '/blog/a?x=1', '/blogs/a/', null, undefined]) {
      expect(isBlogArticlePath(bad), String(bad)).toBe(false);
    }
  });

  it('adresses web : http(s) avec hôte, domaine nu complété, sans identifiants', () => {
    expect(isValidWebUrl('https://exemple.fr/r')).toBe(true);
    expect(isValidWebUrl('www.planity.com/atelier')).toBe(true);
    for (const bad of ['https:/', 'https://', 'ftp://x.fr', 'file:///etc/passwd', 'https://user:p@x.fr', 'javascript:alert(1)', 'https://x.fr/\tx', `https://x.fr/${'a'.repeat(2049)}`]) {
      expect(isValidWebUrl(bad), bad).toBe(false);
    }
  });

  it('téléphone (3 chiffres au moins) et email', () => {
    expect(isValidTel('tel:04 78 00 00 00')).toBe(true);
    expect(isValidTel('TEL:+33 4 78')).toBe(true);
    expect(isValidTel('tel:12')).toBe(false);
    expect(isValidTel('tel:')).toBe(false);
    expect(isValidEmail('mailto:contact@exemple.fr')).toBe(true);
    expect(isValidEmail('mailto:x')).toBe(false);
    expect(isValidEmail('mailto:')).toBe(false);
  });
});

describe('linkTargetsFor', () => {
  it('adresses des pages dédupliquées, blog compris ; pages réservées exclues', () => {
    const targets = linkTargetsFor([...PAGES, page('blog', 'fr'), page('404', 'fr'), page('tarifs', 'fr', [], 'Doublon')], frTarifs);
    expect(targets.pages.map((p) => p.href).slice(0, 4)).toEqual(['/', '/tarifs/', '/en/', '/blog/']);
    expect(targets.pages[0].label).toBe('Accueil (/)');
    expect(targets.pages[1].label).toBe('Tarifs (/tarifs/)');
    expect(targets.pages[3].label).toBe('Actualités (/blog/)');
  });

  it('pages légales générées : celles de la langue de la page en tête, puis des autres langues servies', () => {
    const fr = linkTargetsFor(PAGES, frTarifs).pages;
    expect(fr.map((p) => p.href)).toEqual(['/', '/tarifs/', '/en/', '/blog/', '/mentions-legales/', '/confidentialite/', '/en/legal-notice/', '/en/privacy-policy/']);
    expect(fr[4].label).toBe('Mentions légales (/mentions-legales/)');
    expect(fr[5].label).toBe('Politique de confidentialité (/confidentialite/)');
    expect(fr[7].label).toBe('Politique de confidentialité (/en/privacy-policy/)');
    const en = linkTargetsFor(PAGES, enHome).pages.map((p) => p.href);
    expect(en.slice(4)).toEqual(['/en/legal-notice/', '/en/privacy-policy/', '/mentions-legales/', '/confidentialite/']);
    // Lien vers la politique générée : reconnu (aucun avertissement)
    expect(linkHint('/confidentialite/', linkTargetsFor(PAGES, frTarifs))).toBeNull();
    expect(linkHint('/en/privacy-policy', linkTargetsFor(PAGES, enHome))).toBeNull();
  });

  it('pages légales : langue sans page d’accueil non servie, page du CMS à la même adresse prioritaire', () => {
    // Sans accueil anglais : pas de pages légales anglaises (le site publié ne les génère pas)
    const about = page('about', 'en', [], 'About');
    const noEnHome = linkTargetsFor([frHome, about], about).pages.map((p) => p.href);
    expect(noEnHome).toEqual(['/', '/en/about/', '/blog/', '/mentions-legales/', '/confidentialite/']);
    expect(linkHint('/en/legal-notice/', linkTargetsFor([frHome, about], about))?.warning).toBe(true);
    // Page du CMS « mentions-legales » : proposée une seule fois, sous son titre
    const cms = page('mentions-legales', 'fr', [], 'Infos éditeur');
    const pages = linkTargetsFor([frHome, cms], frHome).pages;
    expect(pages.filter((p) => p.href === '/mentions-legales/').map((p) => p.label)).toEqual(['Infos éditeur (/mentions-legales/)']);
    expect(pages.map((p) => p.href)).toEqual(['/', '/mentions-legales/', '/blog/', '/confidentialite/']);
  });

  it('page sans formulaire : aucune ancre, mode Automatique possible (formulaire sur une autre page)', () => {
    const targets = linkTargetsFor(PAGES, frTarifs);
    expect(targets.anchors).toEqual([]);
    expect(targets.autoHasForm).toBe(true);
  });

  it('page avec formulaire : ancre #contact (et #rendez-vous si un bloc RDV)', () => {
    expect(linkTargetsFor(PAGES, frHome).anchors.map((a) => a.href)).toEqual(['#contact']);
    const both = page('rdv', 'fr', ['contact', 'appointment']);
    expect(linkTargetsFor([both], both).anchors).toEqual([
      { label: 'Formulaire de contact', href: '#contact' },
      { label: 'Formulaire de rendez-vous', href: '#rendez-vous' },
    ]);
    // Plusieurs formulaires du même type : ancres suffixées comme au build
    const twice = page('double', 'fr', ['contact', 'hero', 'contact']);
    expect(linkTargetsFor([twice], twice).anchors.map((a) => a.href)).toEqual(['#contact', '#contact-2']);
  });

  it('langue sans formulaire : mode Automatique indisponible', () => {
    expect(linkTargetsFor(PAGES, enHome).autoHasForm).toBe(false);
  });

  it('page réservée (ignorée au build) : son formulaire ne compte pas', () => {
    const reserved = page('blog', 'fr', ['contact']);
    expect(linkTargetsFor([reserved, frTarifs], frTarifs).autoHasForm).toBe(false);
    // Même adresse dans une autre langue : page générée (/en/blog/)
    expect(linkTargetsFor([page('blog', 'en', ['contact']), enHome], enHome).autoHasForm).toBe(true);
  });
});

describe('linkHint', () => {
  const fr: LinkTargets = linkTargetsFor(PAGES, frHome);
  const en: LinkTargets = linkTargetsFor(PAGES, enHome);

  it('Automatique : formulaire du site, ou avertissement sans formulaire dans la langue', () => {
    expect(linkHint('', fr)).toEqual({ text: expect.stringContaining('formulaire de contact ou de rendez-vous du site'), warning: false });
    const none = linkHint(undefined, en);
    expect(none?.warning).toBe(true);
    expect(none?.text).toContain('ne sera pas affiché');
  });

  it('page ou ancre inconnue : avertissement ; connues : rien', () => {
    expect(linkHint('/supprimee/', fr)?.text).toContain('ne correspond à aucune page');
    expect(linkHint('/supprimee/', fr)?.text).toContain('le bouton mène au formulaire du site.');
    expect(linkHint('/supprimee/', en)?.text).toContain('le bouton ne sera pas affiché.');
    expect(linkHint('#rendez-vous', fr)?.warning).toBe(true);
    expect(linkHint('#contact', fr)).toBeNull();
    expect(linkHint('/tarifs', fr)).toBeNull();
    expect(linkHint('/en/', fr)).toBeNull();
  });

  it('article du blog : indication, sans avertissement', () => {
    expect(linkHint('/blog/mon-article/', fr)).toEqual({ text: expect.stringContaining('article du blog'), warning: false });
  });

  it('adresse web, téléphone, email', () => {
    expect(linkHint('https://exemple.fr/r', fr)).toEqual({ text: expect.stringContaining('nouvel onglet'), warning: false });
    for (const bad of ['https:/', 'javascript:alert(1)']) {
      expect(linkHint(bad, fr)).toEqual({ text: expect.stringContaining('Adresse web invalide'), warning: true });
    }
    expect(linkHint('tel:12', fr)?.text).toContain('Numéro de téléphone incomplet');
    expect(linkHint('tel:04 78 00 00 00', fr)).toBeNull();
    expect(linkHint('mailto:x', fr)?.text).toContain('Adresse email invalide');
    expect(linkHint('mailto:contact@exemple.fr', fr)).toBeNull();
  });

  it('sans cibles : syntaxe seulement, jamais d’avertissement de formulaire', () => {
    expect(linkHint('')?.warning).toBe(false);
    expect(linkHint('/inconnue/')).toBeNull();
    expect(linkHint('#x')).toBeNull();
    expect(linkHint('/a//b')?.text).toContain('le bouton mène au formulaire du site.');
    expect(linkHint('tel:1')?.text).not.toContain('ne sera pas affiché');
  });
});
