import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { fetchAuditLog } from '../../../api/admin';
import type { AuditEntry, AuditPage } from '../../../api/admin';
import { formatDateTimeFr } from '../../../lib/format';
import { AUDIT_CATEGORIES, appendAuditPage, auditParams } from './auditFilters';

type Filters = { category: string; target: string };
const NO_FILTERS: Filters = { category: '', target: '' };

// Tableau des entrées du journal (lecture seule).
export function AuditTable({ entries }: { entries: AuditEntry[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table-cpanel" style={{ fontSize: '0.85rem' }}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Action</th>
            <th>Par</th>
            <th>Cible</th>
            <th>Détails</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{formatDateTimeFr(e.createdAt)}</td>
              <td><span className="badge">{e.action}</span></td>
              <td>{e.actor || '—'}</td>
              <td><code>{e.target || '—'}</code></td>
              <td style={{ color: 'var(--text-muted)' }}>{e.details || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Journal d'audit : actions sensibles, plus récentes d'abord, filtrables par catégorie et
// par cible, chargées par pages. Rechargé (page 1) à l'ouverture, après chaque action
// d'administration (`version`) et à chaque changement de filtres.
export function AuditPanel({ version }: { version: number }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [info, setInfo] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  // Génération du chargement courant : une page suivante arrivée après un rechargement
  // (filtres, version) est ignorée.
  const generation = useRef(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const current = ++generation.current;
    setLoading(true);
    setLoadingMore(false);
    setError(false);
    fetchAuditLog(auditParams({ ...applied, page: 1 }))
      .then((p) => {
        if (cancelled) return;
        setEntries(p.docs);
        setInfo(p);
      })
      .catch(() => {
        if (cancelled) return;
        setEntries([]);
        setInfo(null);
        setError(true);
      })
      .finally(() => {
        if (!cancelled && generation.current === current) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, version, applied, retry]);

  const loadMore = () => {
    if (!info || !info.hasNextPage || loadingMore) return;
    const current = generation.current;
    setLoadingMore(true);
    fetchAuditLog(auditParams({ ...applied, page: info.page + 1 }))
      .then((p) => {
        if (generation.current !== current) return;
        setEntries((prev) => appendAuditPage(prev, p.docs));
        setInfo(p);
      })
      .catch(() => {
        if (generation.current === current) setError(true);
      })
      .finally(() => {
        if (generation.current === current) setLoadingMore(false);
      });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setApplied({ category: draft.category, target: draft.target.trim() });
  };
  const reset = () => {
    setDraft(NO_FILTERS);
    setApplied(NO_FILTERS);
  };

  const filtered = Boolean(applied.category || applied.target);

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '1.1rem', fontWeight: 700, padding: 0 }}
        aria-expanded={open}
      >
        <span>🧾 Journal d'audit</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{open ? '▲ replier' : '▼ afficher'}</span>
      </button>
      {open && (
        <>
          <form onSubmit={submit} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label className="field-label" htmlFor="audit-category">Catégorie</label>
              <select
                id="audit-category"
                className="input-text"
                style={{ padding: 8, fontSize: '0.875rem' }}
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              >
                {AUDIT_CATEGORIES.map((c) => (
                  <option key={c.value || 'toutes'} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px' }}>
              <label className="field-label" htmlFor="audit-target">Cible (site ou email exact)</label>
              <input
                id="audit-target"
                className="input-text"
                style={{ padding: 8, fontSize: '0.875rem' }}
                type="text"
                value={draft.target}
                maxLength={254}
                placeholder="ex. boulangerie-artisanale ou jean@exemple.fr"
                onChange={(e) => setDraft({ ...draft, target: e.target.value })}
              />
            </div>
            <button type="submit" className="btn btn-secondary" disabled={loading}>Filtrer</button>
            <button type="button" className="btn btn-secondary" onClick={reset} disabled={loading || (!filtered && !draft.category && !draft.target)}>Réinitialiser</button>
          </form>

          {error ? (
            <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <p style={{ color: 'var(--accent-rose)', fontSize: '0.85rem', margin: 0 }}>Impossible de charger le journal d'audit.</p>
              <button type="button" className="btn btn-secondary" onClick={() => setRetry((n) => n + 1)}>Réessayer</button>
            </div>
          ) : loading && entries.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Chargement…</p>
          ) : entries.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
              {filtered ? 'Aucune action ne correspond à ces critères.' : 'Aucune action enregistrée pour le moment.'}
            </p>
          ) : (
            <>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }} aria-live="polite">
                {info?.totalDocs ?? entries.length} entrée(s)
              </p>
              <AuditTable entries={entries} />
              {info?.hasNextPage && (
                <button type="button" className="btn btn-secondary" style={{ alignSelf: 'center' }} onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? 'Chargement…' : 'Charger plus'}
                </button>
              )}
            </>
          )}

          {info && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: 0 }}>
              {info.retentionDays > 0
                ? `Conservation : ${info.retentionDays} jours · entrées non modifiables`
                : 'Conservation illimitée'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
