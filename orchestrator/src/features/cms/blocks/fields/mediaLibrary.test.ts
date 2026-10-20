import { describe, expect, it } from 'vitest';
import type { MediaItem } from '../../../../api/media';
import { dimensionsLabel, filterMedia, isCurrentMedia, mediaFilenameFromUrl, replaceMediaItem, usageLabel } from './mediaLibrary';

const item = (over: Partial<MediaItem> = {}): MediaItem => ({
  id: '1',
  filename: 'four.jpg',
  url: '/api/media/file/four.jpg',
  alt: '',
  width: 1600,
  height: 1067,
  filesize: 245 * 1024,
  mimeType: 'image/jpeg',
  createdAt: null,
  usedIn: [],
  ...over,
});

describe('usageLabel', () => {
  it('signale une image inutilisée', () => {
    expect(usageLabel([])).toBe('Non utilisée');
  });
  it('liste les pages et articles (brouillon, langue)', () => {
    expect(usageLabel([
      { type: 'page', title: 'Accueil', slug: 'home', locale: 'fr' },
      { type: 'post', title: 'Noël', slug: 'noel', draft: true },
    ])).toBe('Utilisée dans : page « Accueil », article « Noël » (brouillon)');
    expect(usageLabel([{ type: 'page', title: 'Home', slug: 'home', locale: 'en' }])).toBe('Utilisée dans : page « Home » (EN)');
  });
  it('résume au-delà de trois contenus', () => {
    const usedIn = ['A', 'B', 'C', 'D', 'E'].map((title) => ({ type: 'page' as const, title, slug: title }));
    expect(usageLabel(usedIn)).toBe('Utilisée dans : page « A », page « B », page « C » et 2 autre(s)');
  });
});

describe('mediaFilenameFromUrl', () => {
  it('reconnaît les URLs API et statiques, nom décodé', () => {
    expect(mediaFilenameFromUrl('/api/media/file/four.jpg')).toBe('four.jpg');
    expect(mediaFilenameFromUrl('/api/media/file/mon%20image.png')).toBe('mon image.png');
    expect(mediaFilenameFromUrl('/media/four.jpg?v=2')).toBe('four.jpg');
  });
  it('refuse le reste', () => {
    for (const url of ['https://images.example/four.jpg', '/api/media/file/', '/media/w480/four.jpg', '/preview/x/media/four.jpg', '/api/media/file/%E0%A4%A', '', undefined, null]) {
      expect(mediaFilenameFromUrl(url)).toBeNull();
    }
  });
});

describe('isCurrentMedia', () => {
  it('compare le nom du fichier du champ', () => {
    expect(isCurrentMedia('/api/media/file/four.jpg', item())).toBe(true);
    expect(isCurrentMedia('/media/four.jpg', item())).toBe(true);
    expect(isCurrentMedia('/api/media/file/tasse.jpg', item())).toBe(false);
    expect(isCurrentMedia(undefined, item())).toBe(false);
    expect(isCurrentMedia('https://x.example/four.jpg', item())).toBe(false);
  });
});

describe('filterMedia', () => {
  const items = [
    item({ id: '1', filename: 'four.jpg', alt: 'Four à céramique' }),
    item({ id: '2', filename: 'Été-terrasse.png', alt: '' }),
    item({ id: '3', filename: 'tasse.jpg', alt: 'Tasse ÉMAILLÉE' }),
  ];
  it('cherche dans le nom et le texte alternatif, sans casse ni accents', () => {
    expect(filterMedia(items, 'CERAMIQUE').map((i) => i.id)).toEqual(['1']);
    expect(filterMedia(items, 'ete').map((i) => i.id)).toEqual(['2']);
    expect(filterMedia(items, 'émaillée').map((i) => i.id)).toEqual(['3']);
    expect(filterMedia(items, 'jpg').map((i) => i.id)).toEqual(['1', '3']);
  });
  it('recherche vide : toutes les images', () => {
    expect(filterMedia(items, '   ')).toBe(items);
  });
});

describe('replaceMediaItem', () => {
  it('deux enregistrements concurrents : chacun s’applique à la dernière version de la liste', () => {
    let list = [item({ id: '1' }), item({ id: '2', filename: 'b.jpg' })];
    list = replaceMediaItem(list, item({ id: '1', alt: 'A' }));
    list = replaceMediaItem(list, item({ id: '2', filename: 'b.jpg', alt: 'B' }));
    expect(list.map((i) => i.alt)).toEqual(['A', 'B']);
    expect(replaceMediaItem(list, item({ id: 'inconnu' }))).toEqual(list);
  });
});

describe('dimensionsLabel', () => {
  it('dimensions et poids', () => {
    expect(dimensionsLabel(item())).toBe('1600 × 1067 px · 245 Ko');
  });
  it('parties inconnues omises', () => {
    expect(dimensionsLabel(item({ width: null }))).toBe('245 Ko');
    expect(dimensionsLabel(item({ filesize: null }))).toBe('1600 × 1067 px');
    expect(dimensionsLabel(item({ width: null, filesize: null }))).toBe('');
  });
});
