/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, isHexColor } from './color';

// Fichiers lus tels quels (Vitest neutralise les imports CSS)
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8');
const indexHtml = read('../../index.html');
const mainTsx = read('../main.tsx');
const indexCss = read('../index.css');
const token = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(indexCss)?.[1].trim() ?? '';

describe('polices de l’interface auto-hébergées', () => {
  it('index.html : aucune requête vers Google Fonts', () => {
    expect(indexHtml).not.toContain('fonts.googleapis.com');
    expect(indexHtml).not.toContain('fonts.gstatic.com');
    expect(indexHtml).not.toMatch(/rel=["']?preconnect/);
  });

  it('main.tsx importe Outfit (@fontsource-variable) avant la feuille globale', () => {
    const font = mainTsx.indexOf("import '@fontsource-variable/outfit/wght.css'");
    expect(font).toBeGreaterThanOrEqual(0);
    expect(font).toBeLessThan(mainTsx.indexOf("import './index.css'"));
  });

  it('--font-sans commence par la version variable d’Outfit', () => {
    expect(token('--font-sans')).toMatch(/^'Outfit Variable', 'Outfit',/);
  });

  it('erreurs de saisie (.field-error) en --red-300, contraste ≥ 4,5:1 sur --bg-dark', () => {
    expect(indexCss).toMatch(/\.field-error\s*\{[^}]*color:\s*var\(--red-300\)/);
    const red = token('--red-300');
    const bg = token('--bg-dark');
    expect(isHexColor(red) && isHexColor(bg)).toBe(true);
    expect(contrastRatio(red, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
