import type { AuditEntry } from '../../../api/admin';

// Catégories du journal d'audit : préfixes d'actions (séparés par des virgules) envoyés
// tels quels au serveur (?action=…).
export const AUDIT_CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Toutes les actions' },
  { value: 'utilisateur.,motdepasse.', label: 'Comptes et mots de passe' },
  { value: 'connexion.', label: 'Connexions' },
  { value: 'site.', label: 'Sites et domaines' },
  { value: 'page.,article.,theme.,media.', label: 'Contenu et médias' },
  { value: 'build.', label: 'Publications' },
  { value: 'sauvegarde.,journal.,maintenance.', label: 'Exploitation' },
  { value: 'contact.', label: 'Messages reçus' },
];

// Paramètres de requête : clés vides omises, cible sans espaces superflus.
export function auditParams({ category, target, page }: { category: string; target: string; page: number }): { action?: string; target?: string; page: number } {
  const params: { action?: string; target?: string; page: number } = { page };
  if (category) params.action = category;
  const t = target.trim();
  if (t) params.target = t;
  return params;
}

// Page suivante ajoutée à la liste : sans doublon (une entrée écrite entre deux pages
// décale la pagination), ordre conservé.
export function appendAuditPage(prev: AuditEntry[], next: AuditEntry[]): AuditEntry[] {
  const seen = new Set(prev.map((e) => String(e.id)));
  const out = [...prev];
  for (const entry of next) {
    const key = String(entry.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}
