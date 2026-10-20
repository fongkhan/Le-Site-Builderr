import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBackupSites, restoreBackup } from './admin';
import { deleteSite } from './sites';

// Requêtes de restauration et de suppression avec sauvegarde préalable
function stubFetch(body: unknown = { success: true }) {
  // Une réponse neuve par appel (un corps ne se lit qu'une fois)
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API de restauration', () => {
  it('contenu d’une sauvegarde : nom encodé dans la requête', async () => {
    const fetchMock = stubFetch({ name: 'b', createdAt: null, format: 2, sites: [] });
    await fetchBackupSites('backup-2026-10-01T10-00-00.zip');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/backups/sites?name=backup-2026-10-01T10-00-00.zip');
    await fetchBackupSites('../x');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/backups/sites?name=..%2Fx');
  });

  it('restauration : POST JSON { name, slug, mode }', async () => {
    const fetchMock = stubFetch();
    await restoreBackup('backup-2026-10-01T10-00-00.zip', 'mon-site', 'replace');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/backups/restore');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'backup-2026-10-01T10-00-00.zip', slug: 'mon-site', mode: 'replace' });
  });

  it('suppression : sauvegarde préalable demandée explicitement, désactivée par défaut', async () => {
    const fetchMock = stubFetch({ success: true, message: 'ok', remote: null, backup: 'backup-2026-10-01T10-00-00.zip' });
    const result = await deleteSite('mon-site', true, { backup: true });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sites/mon-site?deleteFiles=true&backup=true');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    expect(result.backup).toBe('backup-2026-10-01T10-00-00.zip');
    await deleteSite('mon-site', false);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/sites/mon-site?deleteFiles=false&backup=false');
  });
});
