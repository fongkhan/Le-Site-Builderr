import { useEffect, useState } from 'react';
import { fetchLegal, publishLegalMissing, saveLegal } from '../../api/legal';
import type { LegalResponse } from '../../api/legal';
import { fetchPages } from '../../api/content';
import { errorMessage } from '../../api/client';
import { useCurrentSite } from '../../state/currentSite';
import { useConfig } from '../../state/ConfigContext';
import { useToast } from '../../components/ui/ToastContext';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { UnsavedChangesPrompt } from '../../components/ui/UnsavedChangesPrompt';
import { publishedSiteUrl } from '../../lib/siteUrls';
import type { LegalInfo, PageDoc, Site } from '../../types';
import {
  EMPTY_LEGAL,
  GENERATED_LEGAL_PAGES,
  HOST_KEYS,
  LEGAL_FIELDS,
  LEGAL_GROUPS,
  coerceLegal,
  isLegalDirty,
  legalPageCollisions,
  missingFields,
  missingLabels,
  prefillFromInfo,
} from './legalModel';
import type { LegalPageCollision } from './legalModel';

// Onglet « Infos légales » d'un site : éditeur, directeur de la publication, hébergeur.
// Alimente les pages « Mentions légales » et « Politique de confidentialité » générées
// sur le site publié (au prochain déploiement). Une instance par site : une réponse
// arrivée après un changement de site ne touche jamais le formulaire du site affiché.
export function LegalPage() {
  const site = useCurrentSite();
  return <LegalEditor key={site.slug} site={site} />;
}

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

function LegalEditor({ site }: { site: Site }) {
  const toast = useToast();
  const { config } = useConfig();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Dernière version enregistrée côté serveur (null tant qu'elle n'est pas chargée)
  const [saved, setSaved] = useState<LegalResponse | null>(null);
  const [value, setValue] = useState<LegalInfo>(EMPTY_LEGAL);
  const [pages, setPages] = useState<PageDoc[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    fetchLegal(site.slug)
      .then((data) => {
        if (cancelled) return;
        const legal = coerceLegal(data?.legal);
        setSaved({ ...data, legal });
        setValue(legal);
        setLoad({ status: 'ready' });
        publishLegalMissing(site.slug, data?.missing || []);
      })
      .catch((err) => {
        if (!cancelled) setLoad({ status: 'error', message: errorMessage(err, 'Impossible de charger les informations légales.') });
      });
    // Pages du site : avertissement de collision et pré-remplissage seulement (un échec
    // ne prive que de ces aides)
    fetchPages(site.slug)
      .then((data) => { if (!cancelled) setPages(Array.isArray(data?.docs) ? data.docs : []); })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [site.slug, attempt]);

  if (load.status === 'loading') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spinner label="Chargement des informations légales…" />
      </div>
    );
  }

  // Non chargées : pas de formulaire (« Enregistrer » viderait les vraies informations)
  if (load.status === 'error' || saved === null) {
    return (
      <div className="glass-panel" style={{ maxWidth: 560, margin: '40px auto' }}>
        <EmptyState
          icon="⚠️"
          title="Impossible de charger les informations légales"
          description={load.status === 'error' ? load.message : undefined}
          action={<button type="button" className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>Réessayer</button>}
        />
      </div>
    );
  }

  const dirty = isLegalDirty(value, saved.legal);
  const prefilled = prefillFromInfo(value, pages);

  const handleSave = async () => {
    if (saving || !dirty) return;
    const sent = value;
    setSaving(true);
    try {
      const res = await saveLegal(site.slug, sent);
      const legal = coerceLegal(res?.legal);
      setSaved({ legal, hostDefaults: res.hostDefaults, missing: res.missing || [], retentionMonths: res.retentionMonths });
      // Valeur nettoyée par le serveur, sauf si la saisie a changé pendant l'envoi
      setValue((current) => (isLegalDirty(current, sent) ? current : legal));
      publishLegalMissing(site.slug, res.missing || []);
      toast.success('Informations légales enregistrées. Republiez le site pour les mettre en ligne.');
    } catch (err) {
      toast.error(errorMessage(err, "Impossible d'enregistrer les informations légales."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <UnsavedChangesPrompt when={dirty} />
      <LegalForm
        value={value}
        hostDefaults={saved.hostDefaults || {}}
        retentionMonths={saved.retentionMonths}
        collisions={legalPageCollisions(pages)}
        siteUrl={site.status === 'active' ? publishedSiteUrl(site, config?.hostingMode) : null}
        canPrefill={prefilled !== value}
        dirty={dirty}
        saving={saving}
        onChange={(key, text) => setValue((current) => ({ ...current, [key]: text }))}
        onPrefill={() => setValue((current) => prefillFromInfo(current, pages))}
        onSubmit={handleSave}
      />
    </>
  );
}

const FIELD_STYLE = { padding: '10px 12px', fontSize: '0.95rem' } as const;
const HINT_STYLE = { fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4, display: 'block', whiteSpace: 'pre-line' } as const;
const NOTICE_STYLE = { padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem' } as const;

// Formulaire (présentationnel : testable sans routeur ni contexte).
export function LegalForm({
  value,
  hostDefaults,
  retentionMonths,
  collisions,
  siteUrl,
  canPrefill,
  dirty,
  saving,
  onChange,
  onPrefill,
  onSubmit,
}: {
  value: LegalInfo;
  hostDefaults: Partial<LegalInfo>;
  retentionMonths: number;
  collisions: LegalPageCollision[];
  /** Adresse du site publié (null : jamais déployé) */
  siteUrl: string | null;
  canPrefill: boolean;
  dirty: boolean;
  saving: boolean;
  onChange: (key: keyof LegalInfo, value: string) => void;
  onPrefill: () => void;
  onSubmit: () => void;
}) {
  const missing = missingLabels(missingFields(value, hostDefaults));
  const pageUrl = (kind: 'notice' | 'privacy') => {
    const page = GENERATED_LEGAL_PAGES.find((p) => p.locale === 'fr' && p.kind === kind);
    return siteUrl && page ? `${siteUrl}${page.slug}/` : '';
  };

  return (
    <form
      className="glass-panel animate-slide"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 820 }}
    >
      <div>
        <h2 style={{ fontSize: '1.2rem' }}>Informations légales</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4 }}>
          Ces informations alimentent les pages « Mentions légales » et « Politique de confidentialité » générées sur votre site, ainsi que les liens en bas de chaque page. Elles sont publiées au prochain déploiement.
        </p>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
          Les textes générés sont un modèle : faites-les vérifier si votre activité a des obligations particulières.
        </p>
      </div>

      {missing.length === 0 ? (
        <div role="status" style={{ ...NOTICE_STYLE, background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)', color: 'var(--accent-emerald)' }}>
          ✓ Informations obligatoires complètes.
        </div>
      ) : (
        <div role="status" style={{ ...NOTICE_STYLE, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.35)', color: 'var(--amber-400)' }}>
          À compléter avant publication : {missing.join(', ')}.
        </div>
      )}

      {collisions.map((c) => (
        <div key={`${c.generated.locale}-${c.generated.slug}`} style={{ ...NOTICE_STYLE, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)' }}>
          Votre page « {c.page.title || c.page.slug} » ({c.address}) remplace la page « {c.generated.label} » générée. Changez son adresse ou supprimez-la dans l'onglet Contenu pour utiliser la page générée.
        </div>
      ))}

      {canPrefill && (
        <div>
          <button type="button" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.85rem' }} onClick={onPrefill}>
            Reprendre l'adresse, le téléphone et l'email du bloc « Infos pratiques »
          </button>
        </div>
      )}

      {LEGAL_GROUPS.map((group) => (
        <fieldset key={group.id} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <legend style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>{group.title}</legend>
          {LEGAL_FIELDS.filter((f) => f.group === group.id).map((f) => {
            const id = `legal-${f.key}`;
            const fallback = HOST_KEYS.includes(f.key) ? (hostDefaults[f.key] || '').trim() : '';
            const hintId = fallback ? `${id}-hint` : undefined;
            const common = {
              id,
              className: 'input-text',
              value: value[f.key],
              maxLength: f.max,
              placeholder: f.placeholder,
              'aria-required': f.required || undefined,
              'aria-describedby': hintId,
              style: FIELD_STYLE,
            };
            return (
              <div key={f.key}>
                <label className="field-label" htmlFor={id}>
                  {f.label}
                  {f.required && <span aria-hidden="true"> *</span>}
                </label>
                {f.multiline ? (
                  <textarea {...common} rows={3} onChange={(e) => onChange(f.key, e.target.value)} />
                ) : (
                  <input {...common} type={f.type || 'text'} onChange={(e) => onChange(f.key, e.target.value)} />
                )}
                {hintId && <span id={hintId} style={HINT_STYLE}>Laissé vide : {fallback}.</span>}
              </div>
            );
          })}
        </fieldset>
      ))}

      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        Messages des formulaires conservés {retentionMonths} mois, puis supprimés automatiquement.
      </p>

      {siteUrl && (
        <p style={{ fontSize: '0.85rem' }}>
          Voir sur le site :{' '}
          <a href={pageUrl('notice')} target="_blank" rel="noreferrer">Mentions légales ↗</a>
          {' · '}
          <a href={pageUrl('privacy')} target="_blank" rel="noreferrer">Politique de confidentialité ↗</a>
        </p>
      )}

      <div>
        <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}
