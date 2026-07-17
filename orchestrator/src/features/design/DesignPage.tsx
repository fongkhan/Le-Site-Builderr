import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { fetchTheme, saveTheme } from '../../api/sites';
import { useToast } from '../../components/ui/ToastContext';
import { Spinner } from '../../components/ui/Spinner';
import { DEFAULT_THEME } from '../../types';
import type { Site, Theme } from '../../types';

const HEADING_FONTS = ['Playfair Display', 'Outfit', 'Space Grotesk', 'Lora', 'Inter'];
const BODY_FONTS = ['Inter', 'DM Sans', 'Karla', 'Plus Jakarta Sans'];

const COLOR_FIELDS: { key: keyof Theme['colors']; label: string }[] = [
  { key: 'primary', label: 'Couleur primaire' },
  { key: 'secondary', label: 'Couleur secondaire' },
  { key: 'background', label: 'Couleur de fond' },
  { key: 'text', label: 'Couleur du texte' },
];

export function DesignPage() {
  const { site } = useOutletContext<{ site: Site }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [savedTheme, setSavedTheme] = useState<Theme | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTheme(site.slug)
      .then((data) => {
        if (cancelled) return;
        const t = data.theme ?? DEFAULT_THEME;
        setTheme(t);
        setSavedTheme(t);
      })
      .catch(() => toast.error('Impossible de récupérer le thème du site.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.slug]);

  const isModified = savedTheme && JSON.stringify(theme) !== JSON.stringify(savedTheme);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveTheme(site.slug, theme);
      setSavedTheme(theme);
      toast.success('Thème enregistré ! Il sera appliqué au prochain déploiement.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde du thème.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spinner label="Chargement du thème…" />
      </div>
    );
  }

  return (
    <div className="animate-slide grid-2col">
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {COLOR_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label className="field-label">{label}</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="color"
                    value={theme.colors[key]}
                    onChange={(e) => setTheme({ ...theme, colors: { ...theme.colors, [key]: e.target.value } })}
                    style={{ border: 'none', background: 'none', width: 32, height: 32, cursor: 'pointer' }}
                  />
                  <input
                    type="text"
                    value={theme.colors[key]}
                    onChange={(e) => setTheme({ ...theme, colors: { ...theme.colors, [key]: e.target.value } })}
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', color: 'white', padding: '4px 8px', borderRadius: 4, width: '100%' }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="field-label">Police des titres</label>
              <select className="select-dark" value={theme.fonts.heading} onChange={(e) => setTheme({ ...theme, fonts: { ...theme.fonts, heading: e.target.value } })}>
                {HEADING_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Police du corps</label>
              <select className="select-dark" value={theme.fonts.body} onChange={(e) => setTheme({ ...theme, fonts: { ...theme.fonts, body: e.target.value } })}>
                {BODY_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="field-label">Bordures arrondies (border-radius)</label>
            <input
              type="text"
              value={theme.radius}
              onChange={(e) => setTheme({ ...theme, radius: e.target.value })}
              style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', color: 'white', padding: 8, borderRadius: 4 }}
              placeholder="ex : 8px, 12px, 0px"
            />
          </div>
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer le thème'}
            </button>
            {isModified && (
              <button className="btn btn-secondary" style={{ borderColor: 'rgba(239, 68, 68, 0.4)', color: 'var(--red-300)' }} onClick={() => savedTheme && setTheme(savedTheme)}>
                Réinitialiser
              </button>
            )}
          </div>
          <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => navigate(`/sites/${site.slug}/cms`)}>
            Étape suivante : éditer le contenu →
          </button>
        </div>
      </div>

      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
        <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>🎨 Aperçu en direct des tokens</h3>
        <div
          style={{
            backgroundColor: theme.colors.background,
            color: theme.colors.text,
            borderRadius: theme.radius,
            fontFamily: `'${theme.fonts.body}', sans-serif`,
            padding: 30,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            border: '1px solid rgba(0,0,0,0.1)',
            minHeight: 350,
          }}
        >
          <h2 style={{ fontFamily: `'${theme.fonts.heading}', serif`, color: theme.colors.text, border: 'none', padding: 0 }}>
            Aperçu de titre de page
          </h2>
          <p>
            Ce paragraphe utilise la police <strong>{theme.fonts.body}</strong>. Les composants du site généré respectent ces tokens.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
            <button style={{ backgroundColor: theme.colors.primary, color: '#ffffff', border: 'none', borderRadius: theme.radius, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 }}>
              Bouton primaire
            </button>
            <button style={{ backgroundColor: theme.colors.secondary, color: theme.colors.text, border: `1px solid ${theme.colors.primary}33`, borderRadius: theme.radius, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 }}>
              Bouton secondaire
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
