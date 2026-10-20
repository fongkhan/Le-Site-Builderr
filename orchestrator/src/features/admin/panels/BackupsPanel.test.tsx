import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { BackupContents, BackupEntry } from '../../../api/admin';
import { BackupsList } from './BackupsPanel';
import { RestoreChoices } from './RestoreBackupModal';

const noop = () => {};
// Texte rendu sans les séparateurs que React insère entre deux nœuds texte
const text = (html: string) => html.replace(/<!-- -->/g, '');
// Balise du bouton radio « remplacer » (l'ordre des attributs n'est pas garanti)
const replaceRadio = (html: string) => (html.match(/<input[^>]*>/g) || []).find((tag) => tag.includes('value="replace"')) || '';

const BACKUP: BackupEntry = { name: 'backup-2026-10-01T10-00-00.zip', size: 2048, createdAt: '2026-10-01T10:00:00.000Z' };

const CONTENTS: BackupContents = {
  name: BACKUP.name,
  createdAt: BACKUP.createdAt,
  format: 2,
  sites: [
    { slug: 'actuel', name: 'Site actuel', pages: 3, posts: 1, media: 2, theme: true, exists: true },
    { slug: 'ancien', name: 'Ancien site', pages: 1, posts: 0, media: 0, theme: true, exists: false },
  ],
};

describe('liste des sauvegardes', () => {
  it('chaque sauvegarde : « Restaurer… » puis « Télécharger »', () => {
    const html = renderToString(<BackupsList backups={[BACKUP]} onRestore={noop} />);
    expect(html).toContain('Restaurer…');
    expect(html).toContain('Télécharger');
    expect(html).toContain('href="/api/admin/backups/download?name=backup-2026-10-01T10-00-00.zip"');
    expect(html).toContain('aria-label="Restaurer la sauvegarde du ');
    expect(html.indexOf('Restaurer…')).toBeLessThan(html.indexOf('Télécharger'));
  });

  it('liste vide : état vide explicite', () => {
    const html = renderToString(<BackupsList backups={[]} onRestore={noop} />);
    expect(html).toContain('Aucune sauvegarde pour');
    expect(html).not.toContain('Restaurer…');
  });
});

describe('choix de restauration', () => {
  it('site supprimé sélectionné : remplacement indisponible, recréé sous son adresse d’origine', () => {
    const html = text(renderToString(<RestoreChoices contents={CONTENTS} selectedSlug="ancien" mode="copy" onSelect={noop} onModeChange={noop} />));
    expect(html).toContain('supprimé depuis');
    expect(replaceRadio(html)).toContain('disabled=""');
    expect(html).toContain('recréé en brouillon');
    expect(html).toContain('(ancien)');
    expect(html).toContain('Indisponible : ce site n&#x27;existe plus.');
    expect(html).not.toContain('Sauvegarde sans images');
  });

  it('site existant : remplacement possible, copie « (restauration) » proposée', () => {
    const html = text(renderToString(<RestoreChoices contents={CONTENTS} selectedSlug="actuel" mode="replace" onSelect={noop} onModeChange={noop} />));
    expect(replaceRadio(html)).not.toBe('');
    expect(replaceRadio(html)).not.toContain('disabled');
    expect(replaceRadio(html)).toContain('checked=""');
    expect(html).toContain('« Site actuel (restauration) »');
    expect(html).toContain('3 page(s) · 1 article(s) · 2 image(s)');
    expect(html).toContain('Créer une copie (recommandé)');
    expect(html).toContain('Remplacer le contenu du site actuel');
    expect(html).not.toContain('Indisponible');
  });

  it('sauvegarde au format 1 : avertissement « sans images »', () => {
    const html = renderToString(<RestoreChoices contents={{ ...CONTENTS, format: 1 }} selectedSlug="actuel" mode="copy" onSelect={noop} onModeChange={noop} />);
    expect(html).toContain('Sauvegarde sans images');
  });
});
