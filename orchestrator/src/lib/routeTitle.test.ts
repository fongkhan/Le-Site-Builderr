import { describe, expect, it } from 'vitest';
import { routeTitle } from './routeTitle';

describe('routeTitle — onglet « Infos légales »', () => {
  it('titre de la section légale d’un site', () => {
    expect(routeTitle('/sites/x/legal', 'Boulangerie')).toBe('Infos légales — Boulangerie · Le Site Builder');
    expect(routeTitle('/sites/x/legal/', 'Boulangerie')).toBe('Infos légales — Boulangerie · Le Site Builder');
  });
});
