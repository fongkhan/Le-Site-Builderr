import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import { deleteMedia, encodeMediaName, fetchMediaLibrary, mediaUrl, updateMediaAlt, uploadMedia } from './media';

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

  it('téléversement : URL canonique construite depuis le nom du fichier, jamais doc.url', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = url.startsWith('/api/payload_sites')
        ? { docs: [{ id: 4, slug: 'mon-site' }] }
        // doc.url de Payload : ( ) ' en clair (encodeURIComponent)
        : { doc: { id: 9, filename: "photo (1) l'atelier.png", url: "/api/media/file/photo%20(1)%20l'atelier.png" } };
      return new Response(JSON.stringify(body), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });
    const file = new File([new Uint8Array([1])], 'photo (1).png', { type: 'image/png' });
    expect(await uploadMedia('mon-site', file)).toEqual({ url: '/api/media/file/photo%20%281%29%20l%27atelier.png' });
    expect(calls[1].url).toBe('/api/media');
    expect(calls[1].init.method).toBe('POST');
    expect(JSON.parse(String((calls[1].init.body as FormData).get('_payload')))).toEqual({ site: 4 });
  });

  it('téléversement sans nom de fichier dans la réponse : ApiError 500', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      new Response(JSON.stringify(url.startsWith('/api/payload_sites') ? { docs: [{ id: 4, slug: 'mon-site' }] } : { doc: { url: '/api/media/file/x.png' } }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }));
    const err = await uploadMedia('mon-site', new File([new Uint8Array([1])], 'x.png', { type: 'image/png' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });

  it('encodeMediaName / mediaUrl : même encodage que le serveur (( ) \' ! * encodés)', () => {
    expect(encodeMediaName("a(b)'c*!.png")).toBe('a%28b%29%27c%2A%21.png');
    expect(mediaUrl('mon image (2).png')).toBe('/api/media/file/mon%20image%20%282%29.png');
    expect(mediaUrl('café.webp')).toBe('/api/media/file/caf%C3%A9.webp');
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
