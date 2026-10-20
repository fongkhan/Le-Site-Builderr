import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { PageDoc } from '../../../../types';
import { linkTargetsFor } from '../../lib/ctaLink';
import { LinkField } from './LinkField';

const noop = () => {};
const home: PageDoc = { title: 'Accueil', slug: 'home', locale: 'fr', layout: [{ blockType: 'hero' }, { blockType: 'contact' }] };
const tarifs: PageDoc = { title: 'Tarifs', slug: 'tarifs', locale: 'fr', layout: [] };
const targets = linkTargetsFor([home, tarifs], home);

const render = (value: string | null | undefined, withTargets = true, compact = false) =>
  renderToString(<LinkField label="Lien du bouton" value={value} onChange={noop} targets={withTargets ? targets : undefined} compact={compact} />);

describe('LinkField', () => {
  it('libellé relié au sélecteur, indication du mode Automatique', () => {
    const html = render(undefined);
    const id = html.match(/<select id="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<label class="field-label" for="${id}"`);
    expect(html).toContain('<option value="" selected="">Automatique : formulaire de contact ou de rendez-vous</option>');
    expect(html).toContain(`aria-describedby="${id}-indication"`);
    expect(html).toContain(`id="${id}-indication"`);
    expect(html).toContain('<optgroup label="Sur cette page"><option value="#contact">Formulaire de contact</option></optgroup>');
  });

  it('page du site sélectionnée', () => {
    const html = render('/tarifs/');
    expect(html).toContain('<option value="/tarifs/" selected=""');
    expect(html).toContain('Tarifs (/tarifs/)');
    expect(html).not.toContain('Lien introuvable');
  });

  it('page légale générée : proposée et sélectionnée sans avertissement', () => {
    const html = render('/confidentialite/');
    expect(html).toContain('<option value="/confidentialite/" selected=""');
    expect(html).toContain('Politique de confidentialité (/confidentialite/)');
    expect(html).toContain('<option value="/mentions-legales/">Mentions légales (/mentions-legales/)</option>');
    expect(html).not.toContain('Lien introuvable');
  });

  it('adresse web : champ de saisie et ouverture dans un nouvel onglet', () => {
    const html = render('https://exemple.fr/r');
    expect(html).toContain('<option value="__web" selected=""');
    expect(html).toMatch(/<input type="url"[^>]*value="https:\/\/exemple\.fr\/r"/);
    expect(html).toContain('aria-label="Adresse web du bouton"');
    expect(html).toContain('nouvel onglet');
  });

  it('téléphone : numéro sans le préfixe tel:', () => {
    const html = render('tel:04 78');
    expect(html).toMatch(/<input type="tel"[^>]*value="04 78"/);
    expect(html).toContain('aria-label="Numéro de téléphone du bouton"');
  });

  it('email : adresse sans le préfixe mailto:', () => {
    const html = render('mailto:contact@exemple.fr');
    expect(html).toMatch(/<input type="email"[^>]*value="contact@exemple\.fr"/);
  });

  it('page supprimée : option « Lien introuvable » sélectionnée et avertissement', () => {
    const html = render('/supprimee/');
    expect(html).toContain('<option value="/supprimee/" selected="">⚠️ Lien introuvable : /supprimee/</option>');
    expect(html).toContain('⚠️ Ce lien ne correspond à aucune page');
  });

  it('sans cibles : ni pages ni ancres proposées, aucun avertissement de page', () => {
    const html = render('/tarifs/', false);
    expect(html).not.toContain('Pages du site');
    expect(html).not.toContain('Sur cette page');
    expect(html).not.toContain('⚠️');
  });

  it('compact : nom accessible par aria-label, sans <label> visible', () => {
    const html = render(null, true, true);
    expect(html).toContain('aria-label="Lien du bouton"');
    expect(html).not.toContain('<label');
  });
});
