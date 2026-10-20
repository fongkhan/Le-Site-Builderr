import { describe, expect, it } from 'vitest';
import type { LegalInfo, PageDoc } from '../../types';
import { EMPTY_LEGAL, coerceLegal, isLegalDirty, legalPageCollisions, missingFields, missingLabels, prefillFromInfo } from './legalModel';

const page = (slug: string, locale: string | undefined, layout: PageDoc['layout'] = [], title = slug): PageDoc => ({ title, slug, locale, layout });

describe('legalPageCollisions', () => {
  it('signale une page du CMS à l’adresse d’une page légale générée (langue servie)', () => {
    const pages = [
      page('home', 'fr'),
      page('mentions-legales', 'fr', [], 'Mentions'),
      page('legal-notice', 'fr'), // adresse anglaise en français : aucune collision
      page('home', 'en'),
      page('privacy-policy', 'en', [], 'Privacy'),
    ];
    const found = legalPageCollisions(pages);
    expect(found.map((c) => c.address)).toEqual(['/mentions-legales/', '/en/privacy-policy/']);
    expect(found[0].page.title).toBe('Mentions');
    expect(found[0].generated.label).toBe('Mentions légales');
    expect(found[1].generated.label).toBe('Politique de confidentialité');
  });

  it('page sans langue = langue par défaut ; langue sans accueil : pas de page générée, pas de collision', () => {
    expect(legalPageCollisions([page('confidentialite', undefined)]).map((c) => c.address)).toEqual(['/confidentialite/']);
    expect(legalPageCollisions([page('home', 'fr'), page('privacy-policy', 'en')])).toEqual([]);
    expect(legalPageCollisions([])).toEqual([]);
  });
});

describe('prefillFromInfo', () => {
  const infoFr = { blockType: 'info', address: ' 1 rue A\n75001 Paris ', phone: '01 00 00 00 00', email: 'fr@exemple.fr' };
  const infoEn = { blockType: 'info', address: 'English address', phone: '+44 0', email: 'en@exemple.fr' };

  it('remplit seulement les champs vides, depuis le premier bloc « Infos pratiques » français', () => {
    const pages = [page('home', 'en', [infoEn]), page('contact', 'fr', [{ blockType: 'hero' }, infoFr])];
    const filled = prefillFromInfo({ ...EMPTY_LEGAL, phone: '06 11 11 11 11' }, pages);
    expect(filled.address).toBe('1 rue A\n75001 Paris');
    expect(filled.email).toBe('fr@exemple.fr');
    expect(filled.phone).toBe('06 11 11 11 11'); // saisie jamais remplacée
    expect(filled.companyName).toBe('');
  });

  it('repli sur une autre langue ; rien à reprendre : même valeur', () => {
    const legal = { ...EMPTY_LEGAL };
    expect(prefillFromInfo(legal, [page('home', 'en', [infoEn])]).email).toBe('en@exemple.fr');
    expect(prefillFromInfo(legal, [page('home', 'fr', [{ blockType: 'hero' }])])).toBe(legal);
    const full: LegalInfo = { ...EMPTY_LEGAL, address: 'a', phone: '1', email: 'e@x.fr' };
    expect(prefillFromInfo(full, [page('home', 'fr', [infoFr])])).toBe(full);
  });
});

describe('manques et modifications', () => {
  it('missingFields : obligatoires vides, hébergeur par défaut pris en compte', () => {
    expect(missingFields(EMPTY_LEGAL)).toEqual(['companyName', 'address', 'phone', 'email', 'publisherName', 'hostName', 'hostAddress', 'hostPhone']);
    expect(missingFields(EMPTY_LEGAL, { hostName: 'o2switch', hostAddress: 'Adresse', hostPhone: ' ' })).toEqual(['companyName', 'address', 'phone', 'email', 'publisherName', 'hostPhone']);
  });

  it('missingLabels : libellés dans l’ordre des champs, clés inconnues ignorées', () => {
    expect(missingLabels(['email', 'companyName', 'inconnu'])).toEqual(["Raison sociale ou nom de l'éditeur", 'Email de contact']);
    expect(missingLabels([])).toEqual([]);
  });

  it('isLegalDirty : une seule différence suffit', () => {
    expect(isLegalDirty(EMPTY_LEGAL, { ...EMPTY_LEGAL })).toBe(false);
    expect(isLegalDirty(EMPTY_LEGAL, { ...EMPTY_LEGAL, hostPhone: '1' })).toBe(true);
  });

  it('coerceLegal : toujours les 11 champs texte', () => {
    const value = coerceLegal({ companyName: 'X', phone: 42 as unknown as string });
    expect(Object.keys(value)).toEqual(Object.keys(EMPTY_LEGAL));
    expect(value.companyName).toBe('X');
    expect(value.phone).toBe('');
    expect(coerceLegal(null)).toEqual(EMPTY_LEGAL);
  });
});
