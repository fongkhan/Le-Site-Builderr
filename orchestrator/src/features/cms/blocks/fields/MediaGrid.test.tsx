import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { MediaItem } from '../../../../api/media';
import { MediaGrid } from './MediaGrid';

const noop = () => {};

const item = (over: Partial<MediaItem> = {}): MediaItem => ({
  id: '1',
  filename: 'four.jpg',
  url: '/api/media/file/four.jpg',
  alt: 'Four à céramique',
  width: 1600,
  height: 1067,
  filesize: 2048,
  mimeType: 'image/jpeg',
  createdAt: null,
  usedIn: [],
  ...over,
});

const render = (items: MediaItem[], extra: { currentUrl?: string; onSelect?: (i: MediaItem) => void; altDrafts?: Record<string, string>; savingId?: string | null } = {}) =>
  renderToString(
    <MediaGrid
      items={items}
      currentUrl={extra.currentUrl}
      altDrafts={extra.altDrafts ?? {}}
      savingId={extra.savingId ?? null}
      onAltChange={noop}
      onAltSave={noop}
      onSelect={extra.onSelect}
      onDelete={noop}
    />,
  );

// Balise ouvrante du bouton dont le texte est `label`.
const buttonTag = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? '';

describe('MediaGrid', () => {
  it('image libre : vignette, dimensions, « Non utilisée », suppression possible', () => {
    const html = render([item()]);
    expect(html).toContain('src="/api/media/file/four.jpg"');
    expect(html).toContain('alt="Four à céramique"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('1600 × 1067 px · 2 Ko');
    expect(html).toContain('Non utilisée');
    const del = buttonTag(html, 'Supprimer');
    expect(del).toContain('btn-danger');
    expect(del).not.toContain('disabled');
  });

  it('suppression désactivée si l’image est utilisée', () => {
    const html = render([item({ usedIn: [{ type: 'page', title: 'Accueil', slug: 'home', locale: 'fr' }] })]);
    const del = buttonTag(html, 'Supprimer');
    expect(del).toContain('disabled=""');
    expect(del).toContain('Image utilisée : retirez-la d&#x27;abord des contenus qui la citent');
    expect(html).toContain('Utilisée dans : page « Accueil »');
  });

  it('image du champ : badge « Sélectionnée », suppression désactivée', () => {
    const html = render([item()], { currentUrl: '/api/media/file/four.jpg' });
    expect(html).toContain('Sélectionnée');
    const del = buttonTag(html, 'Supprimer');
    expect(del).toContain('disabled=""');
    expect(del).toContain('Image sélectionnée dans ce champ');
    expect(render([item()], { currentUrl: '/api/media/file/autre.jpg' })).not.toContain('Sélectionnée');
  });

  it('« Choisir » seulement avec onSelect', () => {
    expect(render([item()])).not.toContain('Choisir');
    expect(buttonTag(render([item()], { onSelect: noop }), 'Choisir')).toContain('btn-primary');
  });

  it('texte alternatif : badge si manquant, champ libellé, compteur, enregistrement selon la saisie', () => {
    const missing = render([item({ alt: '' })]);
    expect(missing).toContain('Texte alternatif manquant');
    expect(missing).toMatch(/<label[^>]*for="([^"]+)"[^>]*>Texte alternatif<\/label><input id="\1"/);
    expect(missing).toContain('maxLength="200"');
    expect(missing).toContain('0/200');
    expect(render([item()])).not.toContain('Texte alternatif manquant');
    // Inchangé : « Enregistrer » désactivé ; brouillon différent : actif
    expect(buttonTag(render([item()]), 'Enregistrer')).toContain('disabled=""');
    const edited = render([item()], { altDrafts: { '1': 'Nouveau texte' } });
    expect(buttonTag(edited, 'Enregistrer')).not.toContain('disabled');
    expect(edited).toContain('value="Nouveau texte"');
    expect(edited).toContain('13/200');
    expect(buttonTag(render([item()], { altDrafts: { '1': 'x' }, savingId: '1' }), 'Enregistrement…')).toContain('disabled=""');
  });

  it('identifiants de champ uniques par image', () => {
    const html = render([item({ id: '1' }), item({ id: '2', filename: 'b.jpg' })]);
    const ids = [...html.matchAll(/<input id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
