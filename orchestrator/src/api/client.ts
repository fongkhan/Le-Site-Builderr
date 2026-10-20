// Client HTTP central : cookies inclus, erreurs JSON normalisées, redirection sur session expirée.

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;

// L'AuthContext s'enregistre ici pour réagir aux 401 (session expirée -> retour au login)
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

// Un corps texte est du JSON ; FormData et Blob gardent leur propre Content-Type
// (multipart, zip…) fixé par le navigateur ou par options.headers.
export const NETWORK_ERROR_MESSAGE = "Serveur injoignable : vérifiez qu'il est démarré (npm start) puis réessayez.";

// Messages des réponses sans corps JSON (proxy, limiteur, serveur en démarrage…).
const STATUS_MESSAGES: Record<number, string> = {
  413: 'Fichier ou contenu trop volumineux',
  429: 'Trop de requêtes, réessayez dans un instant',
  502: 'Serveur indisponible ou en cours de démarrage',
  503: 'Serveur indisponible ou en cours de démarrage',
  504: 'Serveur indisponible ou en cours de démarrage',
};

export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'include',
      ...options,
      headers: {
        ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    // Requête annulée volontairement : propagée telle quelle
    if ((err as { name?: unknown } | null)?.name === 'AbortError') throw err;
    // fetch lève un TypeError quand le serveur ne répond pas (arrêté, réseau coupé)
    if (err instanceof TypeError) throw new ApiError(0, NETWORK_ERROR_MESSAGE);
    throw err;
  }

  if (res.status === 401) {
    onUnauthorized?.();
  }

  if (!res.ok) {
    let message = STATUS_MESSAGES[res.status] ?? `Erreur HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data && (data.error || data.message)) message = data.error || data.message;
      // Payload REST renvoie { errors: [{ message }] }
      if (data && Array.isArray(data.errors) && data.errors[0]?.message) message = data.errors[0].message;
    } catch {
      // corps non-JSON : message de la table, ou générique
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Chemin d'API d'un site : le slug et chaque segment sont toujours encodés.
export function sitePath(slug: string, ...segments: string[]): string {
  return ['/api/sites', slug, ...segments].map((part, i) => (i === 0 ? part : encodeURIComponent(part))).join('/');
}

// Message lisible d'une erreur quelconque (ApiError, Error, autre).
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
