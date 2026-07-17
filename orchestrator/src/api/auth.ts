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
