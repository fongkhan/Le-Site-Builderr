import { useId } from 'react';
import type { MediaItem } from '../../../../api/media';
import { dimensionsLabel, isCurrentMedia, usageLabel } from './mediaLibrary';

const ALT_MAX = 200;

interface MediaGridProps {
  items: MediaItem[];
  /** URL actuelle du champ image (carte « Sélectionnée », suppression bloquée). */
  currentUrl?: string;
  /** Textes alternatifs en cours de saisie, par identifiant d'image. */
  altDrafts: Record<string, string>;
  /** Image dont le texte alternatif est en cours d'enregistrement. */
  savingId: string | null;
  onAltChange: (id: string, value: string) => void;
  onAltSave: (item: MediaItem) => void;
  /** Absent : médiathèque consultée sans champ à remplir (pas de bouton « Choisir »). */
  onSelect?: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
}

const small = { padding: '4px 10px', fontSize: '0.8rem' };

// Grille de la médiathèque (présentationnelle) : vignette, nom, dimensions, usages, texte
// alternatif modifiable et actions de chaque image.
export function MediaGrid({ items, currentUrl, altDrafts, savingId, onAltChange, onAltSave, onSelect, onDelete }: MediaGridProps) {
  const baseId = useId();
  return (
    <ul style={{ listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, padding: 0, margin: 0 }}>
      {items.map((item) => {
        const current = isCurrentMedia(currentUrl, item);
        const used = item.usedIn.length > 0;
        const draft = altDrafts[item.id] ?? item.alt;
        const altId = `${baseId}-alt-${item.id}`;
        const saving = savingId === item.id;
        const deleteBlocked = used ? "Image utilisée : retirez-la d'abord des contenus qui la citent" : current ? 'Image sélectionnée dans ce champ' : undefined;
        return (
          <li
            key={item.id}
            style={{
              display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 10, minWidth: 0,
              border: `1px solid ${current ? 'var(--accent-blue-border)' : 'var(--border-color)'}`,
              background: current ? 'var(--accent-blue-soft)' : 'rgba(255,255,255,0.02)',
            }}
          >
            <div style={{ aspectRatio: '4 / 3', borderRadius: 6, overflow: 'hidden', background: 'rgba(255,255,255,0.05)' }}>
              <img src={item.url} alt={item.alt} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
            <div title={item.filename} style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.filename}
            </div>
            {dimensionsLabel(item) && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{dimensionsLabel(item)}</div>}
            {(current || !item.alt.trim()) && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {current && <span className="badge" style={{ color: 'var(--indigo-200)', borderColor: 'var(--accent-blue-border)' }}>Sélectionnée</span>}
                {!item.alt.trim() && <span className="badge" style={{ color: 'var(--amber-400)' }}>Texte alternatif manquant</span>}
              </div>
            )}
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{usageLabel(item.usedIn)}</div>
            <label className="field-label" htmlFor={altId} style={{ marginTop: 2 }}>Texte alternatif</label>
            <input
              id={altId}
              type="text"
              className="input-text"
              style={{ padding: 4, fontSize: '0.8rem' }}
              maxLength={ALT_MAX}
              placeholder="Décrivez l'image (ex. : four à céramique allumé)"
              value={draft}
              onChange={(e) => onAltChange(item.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft !== item.alt && !saving) {
                  e.preventDefault();
                  onAltSave(item);
                }
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{`${draft.length}/${ALT_MAX}`}</span>
              <button type="button" className="btn btn-secondary" style={small} disabled={draft === item.alt || saving} onClick={() => onAltSave(item)}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
              {onSelect && (
                <button type="button" className="btn btn-primary" style={small} onClick={() => onSelect(item)}>
                  Choisir
                </button>
              )}
              <button type="button" className="btn btn-danger" style={small} disabled={Boolean(deleteBlocked)} title={deleteBlocked} onClick={() => onDelete(item)}>
                Supprimer
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
