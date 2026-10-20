import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '../../../api/admin';
import { AUDIT_CATEGORIES, appendAuditPage, auditParams } from './auditFilters';

const entry = (id: number, action = 'site.creation'): AuditEntry => ({
  id,
  action,
  actor: 'admin@admin.com',
  target: 'boulangerie-artisanale',
  details: null,
  createdAt: '2026-10-01T10:00:00.000Z',
});

describe('journal d’audit : filtres', () => {
  it('auditParams omet les clés vides et trime la cible', () => {
    expect(auditParams({ category: '', target: '   ', page: 1 })).toEqual({ page: 1 });
    expect(auditParams({ category: 'connexion.', target: '  jean@exemple.fr ', page: 3 })).toEqual({
      action: 'connexion.',
      target: 'jean@exemple.fr',
      page: 3,
    });
  });

  it('chaque catégorie respecte le format attendu par le serveur', () => {
    const ACTION_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
    expect(AUDIT_CATEGORIES[0]).toEqual({ value: '', label: 'Toutes les actions' });
    for (const { value, label } of AUDIT_CATEGORIES.slice(1)) {
      const parts = value.split(',');
      expect(label.length).toBeGreaterThan(0);
      expect(parts.length).toBeLessThanOrEqual(10);
      for (const part of parts) expect(part, value).toMatch(ACTION_RE);
    }
    expect(new Set(AUDIT_CATEGORIES.map((c) => c.value)).size).toBe(AUDIT_CATEGORIES.length);
  });

  it('appendAuditPage dédoublonne par id en gardant l’ordre', () => {
    const merged = appendAuditPage([entry(5), entry(4)], [entry(4), entry(3), entry(2)]);
    expect(merged.map((e) => e.id)).toEqual([5, 4, 3, 2]);
    // ids numériques et textuels équivalents
    expect(appendAuditPage([entry(1)], [{ ...entry(1), id: '1' }]).length).toBe(1);
    expect(appendAuditPage([], [entry(7)]).map((e) => e.id)).toEqual([7]);
  });
});
