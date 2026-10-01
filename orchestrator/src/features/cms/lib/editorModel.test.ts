import { describe, expect, it } from 'vitest';
import type { PagesData } from '../../../types';
import {
  findBlock,
  insertBlock,
  moveBlock,
  pageDeletionBlocker,
  removeBlock,
  removePage,
  reorderBlock,
  toEditorPages,
  toServerPages,
  updateBlock,
  updatePage,
  withClientId,
} from './editorModel';

const SERVER_DATA: PagesData = {
  docs: [
    {
      title: 'Accueil',
      slug: 'home',
      locale: 'fr',
      layout: [
        { blockType: 'hero', title: 'Bienvenue' },
        { blockType: 'faq', title: 'FAQ', items: [{ question: 'Q1', answer: 'R1' }] },
        { blockType: 'footer', text: '©' },
      ],
    },
    { title: 'Contact', slug: 'contact', layout: [{ blockType: 'contact', title: 'Écrivez-nous' }] },
  ],
};

const load = () => toEditorPages(structuredClone(SERVER_DATA));

describe('identifiants client', () => {
  it('attribués au chargement, uniques, et retirés avant envoi', () => {
    const pages = load();
    const ids = [...pages.map((p) => p.id), ...pages.flatMap((p) => p.layout.map((b) => b.id))];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);

    const body = toServerPages(pages);
    expect(body).toEqual(SERVER_DATA);
    expect(JSON.stringify(body)).not.toContain('"id"');
  });

  it('un layout absent devient une liste vide', () => {
    const pages = toEditorPages({ docs: [{ title: 'Vide', slug: 'vide' } as never] });
    expect(pages[0].layout).toEqual([]);
  });

  it('remplace un éventuel id hérité', () => {
    const block = withClientId({ blockType: 'hero', id: 'ancien' } as never);
    expect(block.id).not.toBe('ancien');
  });
});

describe('opérations sur les blocs (par identifiant stable)', () => {
  it('updateBlock vise le bloc même après un déplacement, sans toucher aux autres', () => {
    const pages = load();
    const faqId = pages[0].layout[1].id;
    const moved = moveBlock(pages, faqId, -1); // la FAQ passe en tête
    expect(moved[0].layout[0].id).toBe(faqId);

    const updated = updateBlock(moved, faqId, (b) => { b.title = 'Questions'; });
    expect(findBlock(updated, faqId)?.block.title).toBe('Questions');
    expect(findBlock(updated, faqId)?.block.id).toBe(faqId);
    // immuabilité + partage structurel
    expect(moved[0].layout[0].title).toBe('FAQ');
    expect(updated[1]).toBe(moved[1]);
    expect(updated[0].layout[1]).toBe(moved[0].layout[1]);
  });

  it('retour asynchrone après suppression du bloc : aucun effet', () => {
    const pages = load();
    const heroId = pages[0].layout[0].id;
    const without = removeBlock(pages, heroId);
    expect(without[0].layout).toHaveLength(2);
    expect(updateBlock(without, heroId, (b) => { b.title = 'x'; })).toBe(without);
  });

  it('trouve un bloc sur une autre page que la page affichée', () => {
    const pages = load();
    const contactBlockId = pages[1].layout[0].id;
    const updated = updateBlock(pages, contactBlockId, (b) => { b.subtitle = 'Réponse sous 24 h'; });
    expect(updated[1].layout[0].subtitle).toBe('Réponse sous 24 h');
    expect(updated[0]).toBe(pages[0]);
  });

  it('insertBlock, moveBlock aux bornes, reorderBlock', () => {
    const pages = load();
    const [hero, faq, footer] = pages[0].layout;
    expect(moveBlock(pages, hero.id, -1)).toBe(pages);
    expect(moveBlock(pages, footer.id, 1)).toBe(pages);

    const reordered = reorderBlock(pages, footer.id, hero.id);
    expect(reordered[0].layout.map((b) => b.id)).toEqual([footer.id, hero.id, faq.id]);
    expect(reorderBlock(pages, hero.id, hero.id)).toBe(pages);
    expect(reorderBlock(pages, hero.id, pages[1].layout[0].id)).toBe(pages); // autre page : ignoré

    const added = insertBlock(pages, pages[1].id, withClientId({ blockType: 'info' }));
    expect(added[1].layout.map((b) => b.blockType)).toEqual(['contact', 'info']);
    expect(insertBlock(pages, 'inconnue', withClientId({ blockType: 'info' }))).toBe(pages);
  });
});

describe('opérations sur les pages', () => {
  it('updatePage modifie les champs sans toucher aux blocs ni à l’identifiant', () => {
    const pages = load();
    const updated = updatePage(pages, pages[1].id, (p) => { p.title = 'Nous contacter'; p.metaTitle = 'Contact'; });
    expect(updated[1]).toMatchObject({ id: pages[1].id, title: 'Nous contacter', metaTitle: 'Contact', slug: 'contact' });
    expect(updated[1].layout).toBe(pages[1].layout);
    expect(updatePage(pages, 'inconnue', (p) => { p.title = 'x'; })).toBe(pages);
  });

  it('suppression : interdite pour l’accueil français et pour la dernière page', () => {
    const pages = load();
    expect(pageDeletionBlocker(pages[0], pages)).toMatch(/accueil/);
    expect(pageDeletionBlocker(pages[1], pages)).toBeNull();
    const remaining = removePage(pages, pages[1].id);
    expect(toServerPages(remaining).docs.map((p) => p.slug)).toEqual(['home']);

    const enHome = toEditorPages({ docs: [{ title: 'Home', slug: 'home', locale: 'en', layout: [] }, { title: 'A', slug: 'a', layout: [] }] });
    expect(pageDeletionBlocker(enHome[0], enHome)).toBeNull(); // accueil anglais : supprimable
    expect(pageDeletionBlocker(enHome[1], [enHome[1]])).toMatch(/au moins une page/);
  });
});
