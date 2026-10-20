import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { LegalInfo, PageDoc } from '../../types';
import { LegalForm } from './LegalPage';
import { EMPTY_LEGAL, legalPageCollisions } from './legalModel';

const noop = () => {};

const FULL: LegalInfo = {
  companyName: 'Boulangerie Martin',
  legalForm: '',
  address: '1 rue du Pain',
  registration: '',
  vatNumber: '',
  phone: '01 00 00 00 00',
  email: 'contact@exemple.fr',
  publisherName: 'Jeanne Martin',
  hostName: '',
  hostAddress: '',
  hostPhone: '',
};

// HTML rendu, sans les marqueurs <!-- --> que React place entre deux nœuds texte
function render(props: Partial<Parameters<typeof LegalForm>[0]> = {}) {
  return renderToString(
    <LegalForm
      value={EMPTY_LEGAL}
      hostDefaults={{}}
      retentionMonths={12}
      collisions={[]}
      siteUrl={null}
      canPrefill={false}
      dirty={false}
      saving={false}
      onChange={noop}
      onPrefill={noop}
      onSubmit={noop}
      {...props}
    />,
  ).replace(/<!-- -->/g, '');
}

describe('formulaire des informations légales', () => {
  it('libellés reliés, champs obligatoires marqués « * », Enregistrer désactivé sans modification', () => {
    const html = render();
    expect(html).toContain('Informations légales');
    expect(html).toContain('for="legal-companyName"');
    expect(html).toContain('id="legal-companyName"');
    expect(html).toMatch(/Raison sociale ou nom de l(&#x27;|')éditeur<span aria-hidden="true"> \*<\/span>/);
    expect(html).not.toMatch(/Forme juridique et capital<span aria-hidden="true"> \*/);
    expect(html).toContain('aria-required="true"');
    expect(html).toMatch(/<button type="submit" class="btn btn-primary" disabled="">Enregistrer<\/button>/);
    expect(html).toContain('Éditeur du site');
    expect(html).toContain('Directeur ou directrice de la publication');
    expect(html).toContain('Hébergeur');
  });

  it('encadré : champs à compléter, ou informations complètes grâce à l’hébergeur par défaut', () => {
    expect(render()).toContain('À compléter avant publication : ');
    const complete = render({ value: FULL, hostDefaults: { hostName: 'o2switch', hostAddress: 'Chemin des Pardiaux', hostPhone: '04 00 00 00 00' } });
    expect(complete).toContain('✓ Informations obligatoires complètes.');
    expect(complete).toContain('Laissé vide : o2switch.');
    const partial = render({ value: FULL, hostDefaults: { hostName: 'o2switch' } });
    expect(partial).toMatch(/À compléter avant publication : Adresse de l(&#x27;|')hébergeur, Téléphone de l(&#x27;|')hébergeur\./);
  });

  it('collision avec une page du CMS, durée de conservation, liens vers le site publié', () => {
    const pages: PageDoc[] = [{ title: 'Mentions', slug: 'mentions-legales', locale: 'fr', layout: [] }];
    const html = render({ collisions: legalPageCollisions(pages), siteUrl: '/preview/boulangerie/', dirty: true, canPrefill: true });
    expect(html).toMatch(/Votre page « Mentions » \(\/mentions-legales\/\) remplace la page « Mentions légales » générée/);
    expect(html).toContain('Messages des formulaires conservés 12 mois, puis supprimés automatiquement.');
    expect(html).toContain('href="/preview/boulangerie/mentions-legales/"');
    expect(html).toContain('href="/preview/boulangerie/confidentialite/"');
    expect(html).toContain('Infos pratiques');
    expect(html).toMatch(/<button type="submit" class="btn btn-primary">Enregistrer<\/button>/);
  });

  it('site jamais déployé : pas de lien vers le site ; rien à reprendre : pas de bouton', () => {
    const html = render();
    expect(html).not.toContain('Voir sur le site');
    expect(html).not.toContain('Infos pratiques');
  });
});
