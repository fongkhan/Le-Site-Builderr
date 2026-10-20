import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { AuditEntry } from '../../../api/admin';
import { AuditPanel, AuditTable } from './AuditPanel';

const ENTRIES: AuditEntry[] = [
  { id: 2, action: 'connexion.echec', actor: 'anonyme', target: 'lo***@nulle-part.example', details: 'motif=identifiants', createdAt: '2026-10-01T10:00:00.000Z' },
  { id: 1, action: 'journal.purge', actor: 'système', target: '', details: null, createdAt: '2026-09-30T10:00:00.000Z' },
];

describe('journal d’audit : tableau', () => {
  it('affiche action, acteur, cible et détails', () => {
    const html = renderToString(<AuditTable entries={ENTRIES} />);
    expect(html).toContain('connexion.echec');
    expect(html).toContain('anonyme');
    expect(html).toContain('lo***@nulle-part.example');
    expect(html).toContain('motif=identifiants');
    expect(html).toContain('journal.purge');
  });

  it('cible vide : tiret', () => {
    const html = renderToString(<AuditTable entries={[ENTRIES[1]]} />);
    expect(html).toContain('<code>—</code>');
  });

  it('panneau replié par défaut (aucune requête au rendu)', () => {
    const html = renderToString(<AuditPanel version={0} />);
    expect(html).toContain('Journal d');
    expect(html).toContain('▼ afficher');
    expect(html).not.toContain('<table');
  });
});
