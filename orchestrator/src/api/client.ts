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

export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    onUnauthorized?.();
  }

  if (!res.ok) {
    let message = `Erreur HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data && (data.error || data.message)) message = data.error || data.message;
      // Payload REST renvoie { errors: [{ message }] }
      if (data && Array.isArray(data.errors) && data.errors[0]?.message) message = data.errors[0].message;
    } catch {
      // corps non-JSON : on garde le message générique
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
