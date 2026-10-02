import { describe, expect, it } from 'vitest';
import { hasNativeUndo } from './shortcuts';

describe('raccourcis : champs avec annulation native', () => {
  it('saisie de texte : le champ garde son propre annuler', () => {
    for (const type of ['text', 'search', 'email', 'url', 'tel', 'number', 'password', 'date', undefined]) {
      expect(hasNativeUndo({ tagName: 'INPUT', type })).toBe(true);
    }
    expect(hasNativeUndo({ tagName: 'TEXTAREA' })).toBe(true);
    expect(hasNativeUndo({ tagName: 'SELECT' })).toBe(true);
    expect(hasNativeUndo({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('case à cocher, bouton radio, bouton : Ctrl+Z annule dans l’éditeur', () => {
    for (const type of ['checkbox', 'radio', 'button', 'range', 'color']) {
      expect(hasNativeUndo({ tagName: 'INPUT', type })).toBe(false);
    }
    expect(hasNativeUndo({ tagName: 'BUTTON' })).toBe(false);
    expect(hasNativeUndo({ tagName: 'DIV' })).toBe(false);
  });
});
