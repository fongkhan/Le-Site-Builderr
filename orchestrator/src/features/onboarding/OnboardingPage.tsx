import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchConfig, onboard } from '../../api/sites';
import { useSites } from '../../state/SitesContext';
import { useToast } from '../../components/ui/ToastContext';
import { EmptyState } from '../../components/ui/EmptyState';
import type { AiProvider, AppConfig, FeatureFlags, OnboardingResult } from '../../types';

const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: 'OpenAI (GPT-4o mini)',
  anthropic: 'Claude 3.5 Sonnet',
  gemini: 'Gemini 2.5 Flash',
};

const AMBIANCES = [
  { value: 'chaleureux', label: '🍞 Boulangerie / Chaleureux' },
  { value: 'nature', label: '🌿 Éco / Nature / Vert' },
  { value: 'techno', label: '⚡ SaaS / Techno / Sombre' },
  { value: 'minimal', label: '⚫ Studio / Minimaliste / Chic' },
];

export function OnboardingPage() {
  const navigate = useNavigate();
  const { refresh } = useSites();
  const toast = useToast();

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [siteName, setSiteName] = useState('');
  const [description, setDescription] = useState('');
  const [features, setFeatures] = useState<FeatureFlags>({ blog_or_news: false, e_commerce: false, multi_store: false });
  const [ambiance, setAmbiance] = useState('chaleureux');
  const [inspirationType, setInspirationType] = useState<'preset' | 'image'>('preset');
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [inspirationUrl, setInspirationUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);

  useEffect(() => {
    fetchConfig().then((c) => {
      setConfig(c);
      if (c.availableProviders[c.defaultProvider]) {
        setProvider(c.defaultProvider);
      } else {
        const first = (Object.keys(c.availableProviders) as AiProvider[]).find((k) => c.availableProviders[k]);
        if (first) setProvider(first);
      }
    }).catch(() => {});
  }, []);

  const noProviderAvailable = config && !Object.values(config.availableProviders).some(Boolean);

  const readImage = (file: File) => {
    const reader = new FileReader();
    reader.onloadend = () => setUploadedImage(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readImage(file);
  };

  const handleSubmit = async () => {
    if (!description.trim()) {
      toast.error("Décrivez votre activité : c'est la base de la génération.");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const data = await onboard({
        name: siteName,
        description,
        features,
        ambiance: inspirationType === 'preset' ? ambiance : undefined,
        image: inspirationType === 'image' ? (uploadedImage ?? undefined) : undefined,
        inspirationUrl: inspirationUrl || undefined,
        provider,
      });
      setResult(data.qualification);
      setCreatedSlug(data.site.slug);
      await refresh();
      toast.success(`Le site « ${data.site.name} » a été créé et rattaché à votre compte !`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la génération IA.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-slide" style={{ display: 'flex', flexDirection: 'column', gap: 30, maxWidth: 1100, margin: '0 auto' }}>
      <div className="glass-panel">
        <h2 style={{ marginBottom: 15, fontSize: '1.75rem' }}>✨ Créer un nouveau site avec l'IA</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
          Décrivez votre projet : l'assistant conçoit la structure technique, une ébauche de page d'accueil et une identité graphique.
          Vous pourrez ensuite tout ajuster (design, contenu) avant de publier.
        </p>

        {noProviderAvailable && (
          <EmptyState
            icon="🔑"
            title="Aucun fournisseur d'IA configuré"
            description={
              <>Renseignez au moins une clé API (<code>OPENAI_API_KEY</code>, <code>ANTHROPIC_API_KEY</code> ou <code>GEMINI_API_KEY</code>) dans le fichier <code>.env</code> du serveur, puis redémarrez-le.</>
            }
          />
        )}

        {!noProviderAvailable && (
          <div
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
          >
            {config && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-muted)' }}>Modèle d'IA :</span>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {(Object.keys(PROVIDER_LABELS) as AiProvider[]).filter((p) => config.availableProviders[p]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setProvider(p)}
                      className={`btn ${provider === p ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                    >
                      {PROVIDER_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="field-label" style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>Nom du site / projet :</label>
              <input
                type="text"
                className="input-text"
                style={{ padding: '10px 14px' }}
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="Ex: Salon Coiff'Elle, Boulangerie Clamart…"
              />
            </div>
            <div>
              <label className="field-label" style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>Activité et description :</label>
              <textarea
                className="input-text"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Décrivez votre activité, vos services ou produits…"
              />
            </div>

            <div>
              <label className="field-label" style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: 10 }}>Fonctionnalités requises :</label>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={features.e_commerce} onChange={(e) => setFeatures({ ...features, e_commerce: e.target.checked })} style={{ width: 18, height: 18 }} />
                  <span>Vente en ligne / Boutique</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={features.blog_or_news} onChange={(e) => setFeatures({ ...features, blog_or_news: e.target.checked })} style={{ width: 18, height: 18 }} />
                  <span>Blog / Actualités</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={features.multi_store} onChange={(e) => setFeatures({ ...features, multi_store: e.target.checked })} style={{ width: 18, height: 18 }} />
                  <span>Plusieurs boutiques physiques</span>
                </label>
              </div>
            </div>

            <div>
              <label className="field-label" style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: 10 }}>Inspiration graphique :</label>
              <div style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
                <button type="button" onClick={() => setInspirationType('preset')} className={`btn ${inspirationType === 'preset' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '6px 12px', fontSize: '0.85rem', flex: 1 }}>
                  🎨 Ambiance prédéfinie
                </button>
                <button type="button" onClick={() => setInspirationType('image')} className={`btn ${inspirationType === 'image' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '6px 12px', fontSize: '0.85rem', flex: 1 }}>
                  📸 Depuis une image / un logo
                </button>
              </div>

              {inspirationType === 'preset' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                  {AMBIANCES.map((a) => (
                    <button key={a.value} type="button" onClick={() => setAmbiance(a.value)} className={`btn ${ambiance === a.value ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: 10, fontSize: '0.9rem' }}>
                      {a.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    border: '2px dashed var(--border-color)',
                    borderRadius: 8,
                    padding: '20px 10px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: 'rgba(255,255,255,0.01)',
                    position: 'relative',
                    borderColor: uploadedImage ? 'var(--accent-blue)' : 'var(--border-color)',
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) readImage(file);
                  }}
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                  />
                  {uploadedImage ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                      <img src={uploadedImage} alt="Inspiration" style={{ maxHeight: 70, borderRadius: 4, objectFit: 'contain' }} />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Image d'inspiration chargée.</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setUploadedImage(null);
                        }}
                        className="btn btn-secondary"
                        style={{ padding: '4px 8px', fontSize: '0.75rem', zIndex: 10, borderColor: 'rgba(244, 63, 94, 0.4)', color: 'var(--red-300)' }}
                      >
                        Supprimer
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Glissez-déposez une image / un logo ici, ou cliquez pour choisir
                    </span>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="field-label" style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>URL d'un site d'inspiration (optionnel) :</label>
              <input
                type="text"
                className="input-text"
                style={{ padding: '10px 14px' }}
                value={inspirationUrl}
                onChange={(e) => setInspirationUrl(e.target.value)}
                placeholder="Ex: apple.com, stripe.com…"
              />
            </div>

            <button className="btn btn-primary" onClick={handleSubmit} disabled={loading} style={{ width: '100%', padding: '14px 20px', fontSize: '1.05rem' }}>
              {loading ? '🧠 Analyse & génération par l\'IA…' : '✨ Générer l\'ébauche & l\'architecture du site'}
            </button>
          </div>
        )}
      </div>

      {result && createdSlug && (
        <div className="grid-2col animate-slide">
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>🛠️ Spécifications techniques déduites</h3>
            <div>
              <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Nom du site :</span>
              <h2 style={{ color: 'white', marginTop: 4 }}>{result.site_name}</h2>
            </div>
            <div>
              <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Fonctionnalités :</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {[
                  { on: result.features.blog_or_news, label: 'Contenu dynamique / Blog' },
                  { on: result.features.e_commerce, label: 'Vente e-commerce' },
                  { on: result.features.multi_store, label: 'Multi-boutique' },
                ].map((f) => (
                  <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: f.on ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>{f.on ? '● Actif' : '○ Inactif'}</span>
                    <span>{f.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Architecture :</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                <span className="badge" style={{ background: 'var(--accent-blue-soft)', borderColor: 'var(--accent-blue-border)' }}>
                  Astro : mode {result.stack_requirements.astro_mode.toUpperCase()}
                </span>
                {result.stack_requirements.need_payload && <span className="badge" style={{ background: 'rgba(168, 85, 247, 0.15)', borderColor: 'rgba(168, 85, 247, 0.3)' }}>Payload CMS</span>}
                {result.stack_requirements.need_medusajs && <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.3)' }}>MedusaJS API</span>}
                {result.stack_requirements.need_stripe && <span className="badge" style={{ background: 'rgba(244, 63, 94, 0.15)', borderColor: 'rgba(244, 63, 94, 0.3)' }}>Stripe Checkout</span>}
              </div>
            </div>
          </div>

          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>🚀 Votre site est prêt à être personnalisé</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
              L'ébauche (page d'accueil, thème graphique) a été générée et le site est rattaché à votre compte.
              Prochaines étapes :
            </p>
            <ol style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--text-main)', fontSize: '0.95rem' }}>
              <li><strong>Design</strong> — ajustez couleurs, polices et arrondis.</li>
              <li><strong>Contenu</strong> — éditez les sections de la page (textes, produits, FAQ…).</li>
              <li><strong>Déploiement</strong> — publiez le site en un clic.</li>
            </ol>
            <button className="btn btn-primary" style={{ marginTop: 'auto' }} onClick={() => navigate(`/sites/${createdSlug}/design`)}>
              Étape suivante : personnaliser le design →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
