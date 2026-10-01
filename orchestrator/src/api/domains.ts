import { apiFetch, sitePath } from './client';

// --- Domaine personnalisé (admin) : rattacher le vrai nom de domaine d'un client ---

export interface CustomDomainRecord {
  type: 'TXT';
  host: string;
  value: string;
}
export interface AttachDomainResponse {
  customDomain: string;
  domainStatus: string;
  record: CustomDomainRecord;
  pointingHint: string;
}
export interface VerifyDomainResponse {
  verified: boolean;
  domainStatus: string;
  domain?: string;
  sslStatus?: string;
  message?: string;
}

export function attachCustomDomain(slug: string, domain: string): Promise<AttachDomainResponse> {
  return apiFetch(sitePath(slug, 'custom-domain'), { method: 'POST', body: JSON.stringify({ domain }) });
}

export function verifyCustomDomain(slug: string): Promise<VerifyDomainResponse> {
  return apiFetch(sitePath(slug, 'custom-domain', 'verify'), { method: 'POST' });
}

export function detachCustomDomain(slug: string): Promise<{ success: boolean; domain: string; domainStatus: string }> {
  return apiFetch(sitePath(slug, 'custom-domain'), { method: 'DELETE' });
}
