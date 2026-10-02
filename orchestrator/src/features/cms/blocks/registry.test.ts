import { describe, expect, it } from 'vitest';
import { BLOCK_DEFINITIONS, BLOCK_REGISTRY, getBlockDefinition } from './registry';
import { BLOCK_TYPES, blockLabel, createBlock } from './definitions';

// Types de blocs de la collection « pages » (server/payload.config.ts, champ layout).
// Ajouter un bloc côté serveur sans libellé/défauts/éditeur/aperçu côté CMS fait échouer ce test.
const SERVER_BLOCK_TYPES = ['hero', 'features', 'product-grid', 'gallery', 'testimonials', 'faq', 'pricing', 'contact', 'appointment', 'info', 'footer'];

// Blocs à liste : champ de la liste principale
const LIST_FIELDS: Record<string, string> = {
  features: 'items',
  'product-grid': 'products',
  gallery: 'images',
  testimonials: 'testimonials',
  faq: 'items',
  pricing: 'plans',
  appointment: 'services',
};

describe('registre des blocs', () => {
  it('couvre exactement les types de blocs du serveur', () => {
    expect([...BLOCK_TYPES].sort()).toEqual([...SERVER_BLOCK_TYPES].sort());
    expect(Object.keys(BLOCK_REGISTRY).sort()).toEqual([...SERVER_BLOCK_TYPES].sort());
    expect(BLOCK_DEFINITIONS.map((d) => d.type)).toEqual([...BLOCK_TYPES]);
  });

  it.each(SERVER_BLOCK_TYPES)('« %s » a libellé, valeurs par défaut, éditeur et aperçu', (type) => {
    const definition = getBlockDefinition(type);
    expect(definition, `type ${type} absent du registre`).toBeDefined();
    if (!definition) return;
    expect(definition.type).toBe(type);
    expect(definition.label.trim()).not.toBe('');
    expect(definition.label).not.toBe(type);
    expect(definition.icon.trim()).not.toBe('');
    expect(definition.defaults.blockType).toBe(type);
    expect(typeof definition.Editor).toBe('function');
    expect(typeof definition.Preview).toBe('function');
  });

  it.each(Object.entries(LIST_FIELDS))('« %s » a un gabarit de nouvel élément pour « %s »', (type, field) => {
    const definition = getBlockDefinition(type)!;
    expect(definition.newItem).toBeDefined();
    const defaults = definition.defaults as unknown as Record<string, unknown>;
    expect(Array.isArray(defaults[field])).toBe(true);
    // Le gabarit a la même forme que les éléments par défaut
    const sample = (defaults[field] as unknown[])[0];
    expect(typeof definition.newItem).toBe(typeof sample);
    if (typeof sample === 'object' && sample !== null) {
      expect(Object.keys(definition.newItem as object).sort()).toEqual(Object.keys(sample).sort());
    }
  });

  it('libellés lisibles et type inconnu', () => {
    expect(blockLabel('product-grid')).toBe('Produits');
    expect(blockLabel('bloc-inconnu')).toBe('bloc-inconnu');
    expect(getBlockDefinition('bloc-inconnu')).toBeUndefined();
  });

  it('createBlock copie les valeurs par défaut et attribue un identifiant unique', () => {
    const a = createBlock('faq');
    const b = createBlock('faq');
    expect(a.id).not.toBe(b.id);
    expect(a.blockType).toBe('faq');
    a.items!.push({ question: 'Q', answer: 'R' });
    expect(BLOCK_REGISTRY.faq.defaults.items).toHaveLength(2); // défauts jamais mutés
  });
});
