import { apiFetch } from './client';
import type { User } from '../types';

interface MeResponse {
  user: User | null;
}

interface LoginResponse {
  user: User;
}

export function login(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/api/users/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function logout(): Promise<unknown> {
  return apiFetch('/api/users/logout', { method: 'POST' });
}

export async function me(): Promise<User | null> {
  try {
    const data = await apiFetch<MeResponse>('/api/users/me');
    return data.user ?? null;
  } catch {
    return null;
  }
}

// Payload répond 200 que l'email existe ou non (anti-énumération native)
export function forgotPassword(email: string): Promise<unknown> {
  return apiFetch('/api/users/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token: string, password: string): Promise<unknown> {
  return apiFetch('/api/users/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}
