import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import { deleteMedia, fetchMediaLibrary, updateMediaAlt } from './media';

// fetch simulé : enregistre les appels et renvoie la réponse fournie.
function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API médiathèque', () => {
  it('liste : GET /api/sites/<slug>/media, slug encodé, liste vide par défaut', async () => {
    const calls = stubFetch(200, { items: [{ id: '1', filename: 'a.png' }] });
    expect(await fetchMediaLibrary('mon site')).toEqual([{ id: '1', filename: 'a.png' }]);
    expect(calls[0].url).toBe('/api/sites/mon%20site/media');
    expect(calls[0].init.credentials).toBe('include');
    stubFetch(200, {});
    expect(await fetchMediaLibrary('mon-site')).toEqual([]);
  });

  it('texte alternatif : PATCH JSON { alt }', async () => {
    const calls = stubFetch(200, { id: '7', alt: 'Four' });
    expect(await updateMediaAlt('mon-site', '7', 'Four')).toEqual({ id: '7', alt: 'Four' });
    expect(calls[0].url).toBe('/api/sites/mon-site/media/7');
    expect(calls[0].init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ alt: 'Four' });
  });

  it('suppression refusée : ApiError 409 avec le message du serveur', async () => {
    const calls = stubFetch(409, { error: 'Image utilisée dans : page « Accueil ». Retirez-la de ces contenus avant de la supprimer.', usedIn: [] });
    const err = await deleteMedia('mon-site', '7').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toMatch(/^Image utilisée dans : page « Accueil »/);
    expect(calls[0].url).toBe('/api/sites/mon-site/media/7');
    expect(calls[0].init.method).toBe('DELETE');
  });
});
