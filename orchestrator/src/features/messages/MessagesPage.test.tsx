import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { Submission } from '../../api/submissions';
import { MessagesList, replaceSubmission } from './MessagesPage';

const noop = () => {};

const ITEMS: Submission[] = [
  { id: '2', kind: 'appointment', name: 'Alice', email: 'alice@exemple.fr', phone: '0600000000', message: 'Demande de rendez-vous\nPrestation : Coupe', read: false, createdAt: '2026-09-30T10:00:00.000Z' },
  { id: '1', kind: 'contact', name: 'Bob', email: 'bob+test@exemple.fr', phone: '', message: 'Bonjour', read: true, createdAt: '2026-09-29T10:00:00.000Z' },
];

describe('boîte de réception', () => {
  it('badge « Non lu » uniquement sur les messages non lus et lien de réponse mailto', () => {
    const html = renderToString(<MessagesList items={ITEMS} siteName="Boulangerie" onToggleRead={noop} onDelete={noop} />);
    expect(html.match(/>Non lu</g)?.length).toBe(1);
    expect(html).toContain('href="mailto:alice@exemple.fr?subject=');
    // Caractères spéciaux de l'adresse encodés, @ conservé
    expect(html).toContain('href="mailto:bob%2Btest@exemple.fr?subject=');
    expect(html).toContain('Rendez-vous');
    expect(html).toContain('Marquer comme lu');
    expect(html).toContain('Marquer comme non lu');
  });

  it('liste vide : état vide explicite', () => {
    const html = renderToString(<MessagesList items={[]} siteName="Boulangerie" onToggleRead={noop} onDelete={noop} />);
    expect(html).toContain('Aucun message');
  });

  it('deux marquages concurrents : chacun part de la dernière version de la liste', () => {
    let current = ITEMS.map((s) => ({ ...s, read: false }));
    // Réponses de A puis de B (B lancé avant la réponse de A)
    current = replaceSubmission(current, { ...ITEMS[0], read: true });
    current = replaceSubmission(current, { ...ITEMS[1], read: true });
    expect(current.map((s) => s.read)).toEqual([true, true]);
    expect(replaceSubmission(current, { ...ITEMS[0], id: 'inconnu' })).toEqual(current);
  });
});
