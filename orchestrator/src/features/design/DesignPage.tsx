import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchTheme, saveTheme } from '../../api/content';
import { errorMessage } from '../../api/client';
import { useCurrentSite } from '../../state/currentSite';
import { useToast } from '../../components/ui/ToastContext';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { UnsavedChangesPrompt } from '../../components/ui/UnsavedChangesPrompt';
import { DEFAULT_THEME } from '../../types';
import type { Site, Theme } from '../../types';
import { coerceTheme, normalizeTheme, validateTheme } from './themeOptions';
import { ThemePreview } from './components/ThemePreview';
import { ThemeFields } from './components/ThemeFields';

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

  return (
    <div className="animate-slide grid-2col">
      <UnsavedChangesPrompt when={isModified} />
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <h2 style={{ fontSize: '1.5rem' }}>Design & thème</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: 5 }}>
            Ajoutez votre logo et ajustez les couleurs, polices et arrondis pour peaufiner l'identité visuelle de votre site.
          </p>
        </div>

        <div
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleSave();
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
        >
          <ThemeFields siteSlug={site.slug} theme={theme} errors={errors} isModified={isModified} setTheme={setTheme} />
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

      <ThemePreview theme={theme} siteName={site.name} />
    </div>
  );
}
