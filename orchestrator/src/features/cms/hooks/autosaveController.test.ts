import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import { createAutosave, isPermanentSaveError, retryDelay, type AutosaveErrorInfo, type AutosaveState } from './autosaveController';

// Fonction de sauvegarde simulée : chaque appel renvoie une promesse que le test résout
// ou rejette à la main (pour observer l'état « requête en vol »).
function fakeSave() {
  const calls: { data: string; resolve: () => void; reject: (err: unknown) => void }[] = [];
  const save = vi.fn((data: string) => new Promise<void>((resolve, reject) => {
    calls.push({ data, resolve, reject });
  }));
  return { save, calls };
}

function setup(options: { retryMaxMs?: number } = {}) {
  const { save, calls } = fakeSave();
  const states: AutosaveState[] = [];
  const errors: AutosaveErrorInfo[] = [];
  const autosave = createAutosave<string>({
    save,
    debounceMs: 500,
    retryBaseMs: 1000,
    retryMaxMs: options.retryMaxMs ?? 30_000,
    onStateChange: (s) => states.push(s),
    onError: (_err, info) => errors.push(info),
  });
  return { autosave, save, calls, states, errors };
}

// Laisse les promesses se régler (sans avancer le temps)
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('autosave : débounce et requête unique', () => {
  it('regroupe les frappes rapprochées en un seul envoi de la dernière version', async () => {
    const { autosave, save } = setup();
    autosave.schedule('a');
    await vi.advanceTimersByTimeAsync(300);
    autosave.schedule('ab');
    await vi.advanceTimersByTimeAsync(300);
    autosave.schedule('abc');
    expect(autosave.getState().status).toBe('pending');
    await vi.advanceTimersByTimeAsync(499);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith('abc');
    expect(autosave.getState().status).toBe('saving');
  });

  it('saveNow envoie immédiatement, sans débounce', async () => {
    const { autosave, save, calls } = setup();
    autosave.saveNow('x');
    expect(save).toHaveBeenCalledWith('x');
    calls[0].resolve();
    await settle();
    expect(autosave.getState().status).toBe('idle');
  });

  it("une seule requête en vol ; relance à son retour seulement si une édition est arrivée", async () => {
    const { autosave, save, calls } = setup();
    autosave.saveNow('v1');
    autosave.schedule('v2');
    autosave.saveNow('v3');
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1); // toujours une seule requête en vol

    calls[0].resolve();
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('v3'); // la dernière version, pas v2

    calls[1].resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(2); // rien de nouveau : pas de relance
    expect(autosave.getState().status).toBe('idle');
  });

  it("une frappe pendant la requête attend la fin de son débounce", async () => {
    const { autosave, save, calls } = setup();
    autosave.saveNow('v1');
    autosave.schedule('v2');
    calls[0].resolve();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.getState().status).toBe('pending');
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('v2');
  });
});

describe('autosave : erreurs', () => {
  it('erreur réseau / 5xx : nouvel essai avec attente exponentielle plafonnée', async () => {
    const { autosave, save, calls, errors } = setup({ retryMaxMs: 4000 });
    autosave.saveNow('data');
    calls[0].reject(new TypeError('Failed to fetch'));
    await settle();
    expect(autosave.getState()).toMatchObject({ status: 'retrying', retryInMs: 1000, failures: 1, error: 'Failed to fetch' });

    await vi.advanceTimersByTimeAsync(999);
    expect(save).toHaveBeenCalledTimes(1); // pas de rafale : on attend
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);

    calls[1].reject(new ApiError(503, 'Service indisponible'));
    await settle();
    expect(autosave.getState().retryInMs).toBe(2000);
    await vi.advanceTimersByTimeAsync(2000);
    calls[2].reject(new ApiError(500, 'Erreur'));
    await settle();
    expect(autosave.getState().retryInMs).toBe(4000);
    await vi.advanceTimersByTimeAsync(4000);
    calls[3].reject(new ApiError(500, 'Erreur'));
    await settle();
    expect(autosave.getState().retryInMs).toBe(4000); // plafond

    await vi.advanceTimersByTimeAsync(4000);
    expect(save).toHaveBeenCalledTimes(5);
    calls[4].resolve();
    await settle();
    expect(autosave.getState()).toMatchObject({ status: 'idle', error: null, failures: 0 });
    expect(errors.map((e) => e.permanent)).toEqual([false, false, false, false]);
    expect(save.mock.calls.every(([d]) => d === 'data')).toBe(true);
  });

  it("l'essai suivant envoie la version la plus récente", async () => {
    const { autosave, save, calls } = setup();
    autosave.saveNow('v1');
    calls[0].reject(new ApiError(502, 'Bad gateway'));
    await settle();
    autosave.schedule('v2'); // édition pendant l'attente : n'écourte pas l'attente
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.getState().status).toBe('retrying');
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('v2');
  });

  it('erreur 4xx : arrêt des essais automatiques, retry() relance', async () => {
    const { autosave, save, calls, errors } = setup();
    autosave.saveNow('invalide');
    calls[0].reject(new ApiError(400, 'Chaque page doit avoir un titre.'));
    await settle();
    expect(autosave.getState()).toMatchObject({ status: 'error', error: 'Chaque page doit avoir un titre.', retryInMs: null });
    expect(errors).toEqual([{ permanent: true, failures: 1, retryInMs: null }]);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(save).toHaveBeenCalledTimes(1); // aucune boucle

    autosave.retry();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('invalide');
  });

  it('erreur 4xx puis nouvelle édition : la correction est enregistrée normalement', async () => {
    const { autosave, save, calls } = setup();
    autosave.saveNow('invalide');
    calls[0].reject(new ApiError(400, 'Refusé'));
    await settle();
    autosave.schedule('corrigé');
    expect(autosave.getState().status).toBe('pending');
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenLastCalledWith('corrigé');
    calls[1].resolve();
    await settle();
    expect(autosave.getState()).toMatchObject({ status: 'idle', error: null });
  });

  it('erreur 4xx alors qu’une édition plus récente attend : elle part quand même', async () => {
    const { autosave, save, calls } = setup();
    autosave.saveNow('invalide');
    autosave.schedule('corrigé');
    calls[0].reject(new ApiError(400, 'Refusé'));
    await settle();
    expect(autosave.getState().status).toBe('pending');
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('corrigé');
  });

  it('408 et 429 sont temporaires, 401/403/409 définitifs', () => {
    expect(isPermanentSaveError(new ApiError(408, ''))).toBe(false);
    expect(isPermanentSaveError(new ApiError(429, ''))).toBe(false);
    expect(isPermanentSaveError(new ApiError(500, ''))).toBe(false);
    expect(isPermanentSaveError(new TypeError('réseau'))).toBe(false);
    expect(isPermanentSaveError(new ApiError(400, ''))).toBe(true);
    expect(isPermanentSaveError(new ApiError(401, ''))).toBe(true);
    expect(isPermanentSaveError(new ApiError(403, ''))).toBe(true);
    expect(isPermanentSaveError(new ApiError(409, ''))).toBe(true);
  });

  it('retryDelay double à chaque échec puis plafonne', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => retryDelay(n, 1000, 30_000))).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
  });
});

describe('autosave : démontage', () => {
  it('dispose() envoie tout de suite la version en attente', async () => {
    const { autosave, save } = setup();
    autosave.schedule('dernière frappe');
    autosave.dispose();
    expect(save).toHaveBeenCalledWith('dernière frappe');
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('dispose() sans rien en attente ne fait aucun appel', async () => {
    const { autosave, save } = setup();
    autosave.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it('dispose() pendant une requête : la dernière édition part à son retour, sans réessai ensuite', async () => {
    const { autosave, save, calls } = setup();
    autosave.saveNow('v1');
    autosave.schedule('v2');
    autosave.dispose();
    expect(save).toHaveBeenCalledTimes(1);
    calls[0].resolve();
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('v2');
    calls[1].reject(new ApiError(500, 'Erreur'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("dispose() pendant l'attente d'un nouvel essai : un dernier envoi immédiat", async () => {
    const { autosave, save, calls } = setup();
    autosave.saveNow('v1');
    calls[0].reject(new TypeError('réseau'));
    await settle();
    autosave.dispose();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('dispose() pendant une requête refusée : l’édition plus récente part une fois', async () => {
    const { autosave, save, calls } = setup();
    autosave.saveNow('invalide');
    autosave.schedule('corrigé');
    autosave.dispose();
    calls[0].reject(new ApiError(400, 'Refusé'));
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('corrigé');
    calls[1].reject(new ApiError(400, 'Refusé'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("dispose() après un refus définitif ne renvoie pas le même contenu", async () => {
    const { autosave, save, calls } = setup();
    autosave.saveNow('invalide');
    calls[0].reject(new ApiError(400, 'Refusé'));
    await settle();
    autosave.dispose();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
