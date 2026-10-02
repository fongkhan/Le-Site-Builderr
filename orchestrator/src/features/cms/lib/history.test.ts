import { describe, expect, it } from 'vitest';
import { createHistory, GROUP_WINDOW_MS } from './history';

describe('historique annuler/rétablir', () => {
  it('push puis undo / redo', () => {
    const h = createHistory<string>();
    expect(h.canUndo()).toBe(false);
    expect(h.undo('a')).toBeUndefined();
    h.push('a', undefined, 0); // état avant la modification a → b
    h.push('b', undefined, 10); // b → c
    expect(h.undo('c')).toBe('b');
    expect(h.undo('b')).toBe('a');
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);
    expect(h.redo('a')).toBe('b');
    expect(h.redo('b')).toBe('c');
    expect(h.redo('c')).toBeUndefined();
  });

  it('une nouvelle modification vide la pile de rétablissement', () => {
    const h = createHistory<string>();
    h.push('a', undefined, 0);
    expect(h.undo('b')).toBe('a');
    h.push('a', undefined, 5); // a → x
    expect(h.canRedo()).toBe(false);
    expect(h.undo('x')).toBe('a');
  });

  it('regroupe la frappe sur un même champ à moins d’une seconde', () => {
    const h = createHistory<string>();
    h.push('', 'p:b:title', 0); // '' → 'B'
    h.push('B', 'p:b:title', 300); // 'B' → 'Bo'
    h.push('Bo', 'p:b:title', 300 + GROUP_WINDOW_MS - 1); // 'Bo' → 'Bon'
    expect(h.undo('Bon')).toBe(''); // une seule étape
    expect(h.canUndo()).toBe(false);

    const g = createHistory<string>();
    g.push('', 'p:b:title', 0);
    g.push('B', 'p:b:title', GROUP_WINDOW_MS + 1); // pause > 1 s : nouvelle étape
    g.push('Bo', 'p:b:subtitle', GROUP_WINDOW_MS + 2); // autre champ : nouvelle étape
    expect(g.undo('Bon')).toBe('Bo');
    expect(g.undo('Bo')).toBe('B');
    expect(g.undo('B')).toBe('');
  });

  it('une annulation coupe le regroupement en cours', () => {
    const h = createHistory<string>();
    h.push('a', 'k', 0);
    expect(h.undo('b')).toBe('a');
    h.push('a', 'k', 100);
    expect(h.canUndo()).toBe(true);
  });

  it('limite : les étapes les plus anciennes sont oubliées', () => {
    const h = createHistory<number>(3);
    for (let i = 0; i < 5; i++) h.push(i, undefined, i * 2000);
    expect(h.undo(5)).toBe(4);
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBeUndefined();
  });
});
