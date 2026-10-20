import { describe, expect, it } from 'vitest';
import type { RestoreResult } from '../../../api/admin';
import type { Site } from '../../../types';
import { missingImagesMessage, restoreSuccessMessage, skippedContentMessage } from './restoreMessages';

const result = (overrides: Partial<RestoreResult>): RestoreResult => ({
  success: true,
  mode: 'copy',
  site: { slug: 'boutique-restauration', name: 'Boutique (restauration)' } as Site,
  pages: 3,
  posts: 2,
  theme: true,
  media: { restored: 2, copied: 1, kept: 0, missing: [] },
  skipped: { pages: 0, posts: 0, theme: false },
  ...overrides,
});

describe('messages de restauration', () => {
  it('copie : nom, slug, comptes et rappel de rattachement', () => {
    const msg = restoreSuccessMessage(result({}));
    expect(msg).toContain('restauré en copie');
    expect(msg).toContain('slug boutique-restauration');
    expect(msg).toContain('3 page(s), 2 article(s), 3 image(s)');
    expect(msg).toContain("n'est rattaché à aucun compte client");
  });

  it('remplacement : sauvegarde de sécurité et publication à faire', () => {
    const msg = restoreSuccessMessage(result({
      mode: 'replace',
      site: { slug: 'boutique', name: 'Boutique' } as Site,
      safetyBackup: 'backup-2026-10-20T10-00-00.zip',
    }));
    expect(msg).toContain('Contenu de « Boutique » remplacé');
    expect(msg).toContain('Sauvegarde de sécurité : backup-2026-10-20T10-00-00.zip');
    expect(msg).toContain('Publiez le site');
  });

  it('images introuvables : null si aucune, 5 noms au plus', () => {
    expect(missingImagesMessage([])).toBeNull();
    expect(missingImagesMessage(['a.png'])).toBe('Images introuvables (absentes de la sauvegarde) : a.png.');
    const msg = missingImagesMessage(['a.png', 'b.png', 'c.png', 'd.png', 'e.png', 'f.png', 'g.png']);
    expect(msg).toContain('a.png, b.png, c.png, d.png, e.png');
    expect(msg).not.toContain('f.png');
    expect(msg?.endsWith('et 2 autre(s).')).toBe(true);
  });

  it('éléments écartés : null si rien, sinon pages, articles et thème', () => {
    expect(skippedContentMessage({ pages: 0, posts: 0, theme: false })).toBeNull();
    expect(skippedContentMessage({ pages: 2, posts: 1, theme: true })).toBe('Éléments invalides écartés : 2 page(s), 1 article(s), thème.');
    expect(skippedContentMessage({ pages: 1, posts: 0, theme: false })).toBe('Éléments invalides écartés : 1 page(s), 0 article(s).');
  });
});
