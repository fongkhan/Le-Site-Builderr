import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToastQueue, durationFor, MAX_TOASTS, type QueuedToast } from './toastQueue';

describe('file des toasts', () => {
  let shown: QueuedToast[] = [];
  const queue = () => createToastQueue((toasts) => { shown = toasts; });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    shown = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('durées : erreurs 12 s, succès et informations 5 s', () => {
    expect(durationFor('error')).toBe(12_000);
    expect(durationFor('success')).toBe(5_000);
    expect(durationFor('info')).toBe(5_000);
  });

  it('un succès expire à 5 s', () => {
    const q = queue();
    q.add('success', 'Enregistré');
    vi.advanceTimersByTime(4_999);
    expect(shown).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(shown).toHaveLength(0);
  });

  it('pause à 3 s puis reprise à 10 s : expiration à 12 s', () => {
    const q = queue();
    const id = q.add('success', 'Section supprimée', { label: 'Annuler', onClick: () => {} });
    vi.advanceTimersByTime(3_000);
    q.pause(id);
    expect(q.remaining(id)).toBe(2_000);
    vi.advanceTimersByTime(7_000); // t = 10 s, toujours en pause
    expect(shown.map((t) => t.id)).toEqual([id]);
    q.resume(id);
    vi.advanceTimersByTime(1_999);
    expect(shown).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(shown).toHaveLength(0);
  });

  it('pause et reprise répétées sans effet de bord ; une erreur dure 12 s', () => {
    const q = queue();
    const id = q.add('error', 'Échec');
    q.pause(id);
    q.pause(id);
    vi.advanceTimersByTime(60_000);
    q.resume(id);
    q.resume(id);
    vi.advanceTimersByTime(11_999);
    expect(shown).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(shown).toHaveLength(0);
  });

  it(`pile limitée à ${MAX_TOASTS} toasts : les plus anciens cèdent la place`, () => {
    const q = queue();
    for (let i = 1; i <= MAX_TOASTS + 2; i++) q.add('info', `n°${i}`);
    expect(shown.map((t) => t.message)).toEqual(['n°3', 'n°4', 'n°5', 'n°6']);
    q.dismiss(shown[0].id);
    expect(shown).toHaveLength(MAX_TOASTS - 1);
    q.dispose();
    vi.advanceTimersByTime(60_000); // aucun minuteur restant ne relance l'affichage
    expect(shown).toHaveLength(MAX_TOASTS - 1);
  });
});
