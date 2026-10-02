import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchTheme, saveTheme } from '../../api/content';
import { errorMessage } from '../../api/client';
import { toHex6 } from '../../lib/color';
import { useCurrentSite } from '../../state/currentSite';
import { useToast } from '../../components/ui/ToastContext';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { UnsavedChangesPrompt } from '../../components/ui/UnsavedChangesPrompt';
import { DEFAULT_THEME } from '../../types';
import type { Site, Theme } from '../../types';
import { BODY_FONTS, COLOR_FIELDS, HEADING_FONTS, THEME_PRESETS, coerceTheme, normalizeTheme, validateTheme } from './themeOptions';
import { ThemePreview } from './components/ThemePreview';

const ERROR_TEXT = { color: 'var(--accent-rose)', fontSize: '0.75rem', marginTop: 4, display: 'block' } as const;
const TEXT_INPUT = { background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', color: 'white', padding: '4px 8px', borderRadius: 4, width: '100%' } as const;

export function DesignPage() {
  const site = useCurrentSite();
  // Une instance par site : jamais le thème d'un site affiché (ou enregistré) sur un autre
  return <DesignEditor key={site.slug} site={site} />;
}

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

function DesignEditor({ site }: { site: Site }) {
  const navigate = useNavigate();
  const toast = useToast();

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  // Dernier thème connu du serveur (null tant qu'il n'est pas chargé)
  const [savedTheme, setSavedTheme] = useState<Theme | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    fetchTheme(site.slug)
      .then((data) => {
        if (cancelled) return;
        const loaded = coerceTheme(data?.theme);
        setTheme(loaded);
        setSavedTheme(loaded);
        setLoad({ status: 'ready' });
      })
      .catch((err) => {
        if (!cancelled) setLoad({ status: 'error', message: errorMessage(err, 'Impossible de récupérer le thème du site.') });
      });
    return () => {
      cancelled = true;
    };
  }, [site.slug, loadAttempt]);

  if (load.status === 'loading') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spinner label="Chargement du thème…" />
      </div>
    );
  }

  // Thème non chargé : pas d'éditeur (« Enregistrer » écraserait le vrai thème par le défaut)
  if (load.status === 'error' || savedTheme === null) {
    return (
      <div className="glass-panel" style={{ maxWidth: 560, margin: '40px auto' }}>
        <EmptyState
          icon="⚠️"
          title="Impossible de charger le thème du site"
          description={`${load.status === 'error' ? load.message : ''} Rien n'a été modifié : l'éditeur de thème s'ouvrira une fois le thème chargé.`}
          action={<button type="button" className="btn btn-primary" onClick={() => setLoadAttempt((n) => n + 1)}>Réessayer</button>}
        />
      </div>
    );
  }

  const errors = validateTheme(theme);
  const isModified = JSON.stringify(theme) !== JSON.stringify(savedTheme);
  const canSave = !saving && errors === null;

  const setColor = (key: keyof Theme['colors'], value: string) => setTheme((t) => ({ ...t, colors: { ...t.colors, [key]: value } }));

  const handleSave = async () => {
    if (!canSave) return;
    const sent = normalizeTheme(theme);
    setSaving(true);
    try {
      await saveTheme(site.slug, sent);
      setSavedTheme(sent);
      setTheme((current) => (JSON.stringify(current) === JSON.stringify(theme) ? sent : current));
      toast.success('Thème enregistré ! Il sera appliqué au prochain déploiement.');
    } catch (err) {
      toast.error(errorMessage(err, 'Erreur lors de la sauvegarde du thème.'));
    } finally {
      setSaving(false);
    }
  };

  // Police hors liste (thème ancien) : affichée telle quelle et signalée, jamais remplacée en silence
  const fontOptions = (fonts: readonly string[], current: string) => (
    <>
      {!fonts.includes(current) && <option value={current} disabled>{current} (non disponible)</option>}
      {fonts.map((f) => <option key={f} value={f}>{f}</option>)}
    </>
  );

  return (
    <div className="animate-slide grid-2col">
      <UnsavedChangesPrompt when={isModified} />
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <h2 style={{ fontSize: '1.5rem' }}>Design & thème</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: 5 }}>
            Ajustez les couleurs, polices et arrondis pour peaufiner l'identité visuelle de votre site.
          </p>
        </div>

        <div
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleSave();
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 15, borderTop: '1px solid var(--border-color)', paddingTop: 15 }}
        >
          <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            Variables du thème
            {isModified && (
              <span className="badge animate-slide" style={{ background: 'rgba(244, 63, 94, 0.15)', borderColor: 'rgba(244, 63, 94, 0.3)', color: '#fda4af', fontWeight: 600, fontSize: '0.75rem' }}>
                ⚠️ Brouillon non sauvegardé
              </span>
            )}
          </h3>

          <div>
            <span className="field-label">Palettes prêtes à l'emploi</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {THEME_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '5px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6 }}
                  onClick={() => setTheme(structuredClone(preset.theme))}
                  title={`Appliquer la palette « ${preset.name} »`}
                >
                  <span style={{ display: 'inline-flex', gap: 2 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: preset.theme.colors.primary, display: 'inline-block' }} />
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: preset.theme.colors.secondary, display: 'inline-block' }} />
                  </span>
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {COLOR_FIELDS.map(({ key, label }) => {
              const error = errors?.colors[key];
              return (
                <div key={key}>
                  <label className="field-label" htmlFor={`theme-color-${key}`}>{label}</label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {/* Le sélecteur natif n'accepte que #rrggbb : #RGB / #RRGGBBAA y sont normalisés */}
                    <input
                      type="color"
                      aria-label={`${label} (sélecteur)`}
                      value={toHex6(theme.colors[key].trim())}
                      onChange={(e) => setColor(key, e.target.value)}
                      style={{ border: 'none', background: 'none', width: 32, height: 32, cursor: 'pointer' }}
                    />
                    <input
                      id={`theme-color-${key}`}
                      type="text"
                      value={theme.colors[key]}
                      aria-invalid={Boolean(error)}
                      onChange={(e) => setColor(key, e.target.value)}
                      style={{ ...TEXT_INPUT, borderColor: error ? 'var(--accent-rose)' : 'var(--border-color)' }}
                    />
                  </div>
                  {error && <span style={ERROR_TEXT}>{error}</span>}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="field-label" htmlFor="theme-font-heading">Police des titres</label>
              <select id="theme-font-heading" className="select-dark" value={theme.fonts.heading} onChange={(e) => setTheme((t) => ({ ...t, fonts: { ...t.fonts, heading: e.target.value } }))}>
                {fontOptions(HEADING_FONTS, theme.fonts.heading)}
              </select>
              {errors?.heading && <span style={ERROR_TEXT}>{errors.heading}</span>}
            </div>
            <div>
              <label className="field-label" htmlFor="theme-font-body">Police du corps</label>
              <select id="theme-font-body" className="select-dark" value={theme.fonts.body} onChange={(e) => setTheme((t) => ({ ...t, fonts: { ...t.fonts, body: e.target.value } }))}>
                {fontOptions(BODY_FONTS, theme.fonts.body)}
              </select>
              {errors?.body && <span style={ERROR_TEXT}>{errors.body}</span>}
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="theme-radius">Bordures arrondies (border-radius)</label>
            <input
              id="theme-radius"
              type="text"
              value={theme.radius}
              aria-invalid={Boolean(errors?.radius)}
              onChange={(e) => setTheme((t) => ({ ...t, radius: e.target.value }))}
              style={{ ...TEXT_INPUT, padding: 8, borderColor: errors?.radius ? 'var(--accent-rose)' : 'var(--border-color)' }}
              placeholder="ex : 8px, 12px, 0"
            />
            {errors?.radius && <span style={ERROR_TEXT}>{errors.radius}</span>}
          </div>
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={handleSave}
              disabled={!canSave}
              title={errors ? 'Corrigez les valeurs signalées avant d’enregistrer.' : undefined}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer le thème'}
            </button>
            {isModified && (
              <button type="button" className="btn btn-secondary" style={{ borderColor: 'rgba(239, 68, 68, 0.4)', color: 'var(--red-300)' }} onClick={() => setTheme(savedTheme)} disabled={saving}>
                Réinitialiser
              </button>
            )}
          </div>
          <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={() => navigate(`/sites/${site.slug}/cms`)}>
            Étape suivante : éditer le contenu →
          </button>
        </div>
      </div>

      <ThemePreview theme={theme} />
    </div>
  );
}
