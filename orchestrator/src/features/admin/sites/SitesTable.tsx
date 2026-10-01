import { useState } from 'react';
import { Link } from 'react-router-dom';
import { exportSiteUrl } from '../../../api/sites';
import { EmptyState } from '../../../components/ui/EmptyState';
import { useConfig } from '../../../state/ConfigContext';
import { publishedSiteUrl } from '../../../lib/siteUrls';
import { SITE_STATUS_DISPLAY, SSL_DISPLAY, SSL_UNKNOWN } from '../constants';
import type { Site } from '../../../types';

const actionStyle = { padding: '4px 10px', fontSize: '0.8rem' };

export function SitesTable({ sites, owners, duplicating, onEdit, onFiles, onDelete, onDuplicate }: {
  sites: Site[];
  owners: Record<string, string[]>;
  /** Slug du site en cours de duplication (bouton désactivé : pas de double copie) */
  duplicating: string | null;
  onEdit: (s: Site) => void;
  onFiles: (s: Site) => void;
  onDelete: (s: Site) => void;
  onDuplicate: (s: Site) => void;
}) {
  const { config } = useConfig();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<'name' | 'status' | 'stack'>('name');

  const q = query.trim().toLowerCase();
  const filtered = sites
    .filter((s) => !q || s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q) || (s.domain || '').toLowerCase().includes(q))
    .slice()
    .sort((a, b) => String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''), 'fr'));

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
        <h3 style={{ fontSize: '1.5rem' }}>🌐 Sites hébergés (structure cPanel)</h3>
        {sites.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="search"
              className="input-text"
              style={{ padding: '6px 10px', fontSize: '0.85rem', minWidth: 180 }}
              placeholder="🔍 Rechercher un site…"
              aria-label="Rechercher un site"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select className="select-dark" aria-label="Trier les sites" value={sortKey} onChange={(e) => setSortKey(e.target.value as typeof sortKey)} style={{ padding: '6px 10px', fontSize: '0.85rem' }}>
              <option value="name">Trier par nom</option>
              <option value="status">Trier par statut</option>
              <option value="stack">Trier par stack</option>
            </select>
          </div>
        )}
      </div>

      {sites.length === 0 ? (
        <EmptyState
          icon="🌐"
          title="Aucun site enregistré"
          description="Créez un site via le formulaire ci-dessus, importez-en un via le scan, ou utilisez l'assistant IA."
          action={
            <Link to="/onboarding" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              ✨ Créer avec l'IA
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Aucun site ne correspond à « {query} ».</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table-cpanel">
            <thead>
              <tr>
                <th>Site / Projet</th>
                <th>Domaine / Lien</th>
                <th>Racine & sources</th>
                <th>Stack</th>
                <th>SSL</th>
                <th>Source</th>
                <th>Statut</th>
                <th>Clients</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((site) => {
                const status = SITE_STATUS_DISPLAY[site.status] ?? SITE_STATUS_DISPLAY.draft;
                const ssl = SSL_DISPLAY[site.sslStatus] ?? SSL_UNKNOWN;
                const deployed = site.status === 'active';
                const siteOwners = owners[site.slug] || [];
                return (
                  <tr key={site.slug}>
                    <td style={{ fontWeight: 600 }}>
                      {site.name}
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>slug : {site.slug}</div>
                    </td>
                    <td>
                      {deployed ? (
                        <a href={publishedSiteUrl(site, config?.hostingMode)} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: 500 }}>
                          {site.domain} ↗
                        </a>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }} title="Jamais déployé : lancez un build pour générer le site.">
                          {site.domain} <span className="badge" style={{ fontSize: '0.7rem', color: 'var(--amber-400)' }}>non déployé</span>
                        </span>
                      )}
                      {site.domainStatus === 'active' && (
                        <div><span className="badge" style={{ fontSize: '0.68rem', color: 'var(--accent-emerald)' }} title="Domaine personnalisé du client actif">🌐 domaine perso</span></div>
                      )}
                      {site.domainStatus === 'pending' && (
                        <div><span className="badge" style={{ fontSize: '0.68rem', color: 'var(--amber-400)' }} title={`Vérification en attente : ${site.customDomain || ''}`}>🌐 domaine en attente</span></div>
                      )}
                    </td>
                    <td style={{ fontSize: '0.8rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div>
                          <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>WebRoot :</span>{' '}
                          <code style={{ color: 'var(--blue-300)' }}>{site.documentRoot}</code>
                        </div>
                        {site.repositoryPath && (
                          <div>
                            <span style={{ color: 'var(--purple-300)', fontWeight: 600 }}>Repo :</span>{' '}
                            <code style={{ color: '#e9d5ff' }}>{site.repositoryPath}</code>
                          </div>
                        )}
                      </div>
                    </td>
                    <td><span className="badge">{site.stack}</span></td>
                    <td style={{ color: ssl.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{ssl.label}</td>
                    <td style={{ fontSize: '0.8rem' }}>
                      {site.createdWithTool ? <span style={{ color: 'var(--purple-300)' }}>🛠️ Généré</span> : <span style={{ color: 'var(--text-muted)' }}>📁 Importé</span>}
                    </td>
                    <td>
                      <span className="status-dot" style={{ background: status.color }} />
                      <span>{status.label}</span>
                    </td>
                    <td style={{ fontSize: '0.8rem' }}>
                      {siteOwners.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {siteOwners.map((email) => (
                            <span key={email} style={{ color: 'var(--text-main)' }}>{email}</span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <Link to={`/sites/${encodeURIComponent(site.slug)}/design`} className="btn btn-secondary" style={{ ...actionStyle, textDecoration: 'none' }}>
                          Gérer
                        </Link>
                        <button className="btn btn-secondary" style={{ ...actionStyle, borderColor: 'rgba(99,102,241,0.4)', color: 'var(--indigo-200)' }} onClick={() => onEdit(site)}>
                          ✏️ Modifier
                        </button>
                        <button className="btn btn-secondary" style={actionStyle} onClick={() => onFiles(site)}>
                          📁 Fichiers
                        </button>
                        <a href={exportSiteUrl(site.slug)} download className="btn btn-secondary" style={{ ...actionStyle, textDecoration: 'none' }} title="Télécharger une sauvegarde (pages, articles, thème et build)">
                          📦 Exporter
                        </a>
                        <button
                          className="btn btn-secondary"
                          style={actionStyle}
                          onClick={() => onDuplicate(site)}
                          disabled={duplicating !== null}
                          title="Créer un jumeau de ce site (pages, articles et thème)"
                        >
                          {duplicating === site.slug ? 'Duplication…' : '⧉ Dupliquer'}
                        </button>
                        <button className="btn btn-secondary" style={{ ...actionStyle, borderColor: 'rgba(244,63,94,0.4)', color: 'var(--red-300)' }} onClick={() => onDelete(site)}>
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
