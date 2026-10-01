import { useRef, useState } from 'react';
import { onboard } from '../../api/onboarding';
import { preferredProvider } from '../../api/ai';
import { ApiError, errorMessage } from '../../api/client';
import { useSites } from '../../state/SitesContext';
import { useConfig } from '../../state/ConfigContext';
import { useToast } from '../../components/ui/ToastContext';
import { EmptyState } from '../../components/ui/EmptyState';
import { InspirationImage } from './InspirationImage';
import { OnboardingResult } from './OnboardingResult';
import type { AiProvider, FeatureFlags, OnboardingResult as Qualification } from '../../types';

// Le modèle exact est réglé côté serveur (OPENAI_MODEL, ANTHROPIC_MODEL, GEMINI_MODEL).
const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: 'OpenAI (GPT)',
  anthropic: 'Anthropic (Claude)',
  gemini: 'Google (Gemini)',
};

const AMBIANCES = [
  { value: 'chaleureux', label: '🍞 Boulangerie / Chaleureux' },
  { value: 'nature', label: '🌿 Éco / Nature / Vert' },
  { value: 'techno', label: '⚡ SaaS / Techno / Sombre' },
  { value: 'minimal', label: '⚫ Studio / Minimaliste / Chic' },
];

const NO_FEATURES: FeatureFlags = { blog_or_news: false, e_commerce: false, multi_store: false };

export function OnboardingPage() {
  const { refresh } = useSites();
  const { config, refresh: refreshConfig } = useConfig();
  const toast = useToast();

  // Choix explicite de l'utilisateur ; sinon le fournisseur préféré de la configuration
  const [chosenProvider, setChosenProvider] = useState<AiProvider | null>(null);
  const provider = chosenProvider ?? preferredProvider(config) ?? 'openai';
  const [siteName, setSiteName] = useState('');
  const [description, setDescription] = useState('');
  const [features, setFeatures] = useState<FeatureFlags>(NO_FEATURES);
  const [ambiance, setAmbiance] = useState('chaleureux');
  const [inspirationType, setInspirationType] = useState<'preset' | 'image'>('preset');
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [inspirationUrl, setInspirationUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Qualification | null>(null);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  // Anti double soumission (bouton ET raccourci Ctrl+Entrée) : un seul site par demande
  const submitting = useRef(false);

  const noProviderAvailable = config && !Object.values(config.availableProviders).some(Boolean);
  const quota = config?.aiQuota ?? null;
  const quotaExhausted = quota !== null && quota.remaining <= 0;

  const handleSubmit = async () => {
    if (submitting.current || loading || quotaExhausted) return;
    if (!description.trim()) {
      toast.error("Décrivez votre activité : c'est la base de la génération.");
      return;
    }
    if (inspirationType === 'image' && !uploadedImage) {
      toast.error('Ajoutez une image ou un logo, ou choisissez une ambiance prédéfinie.');
      return;
    }
    submitting.current = true;
    setLoading(true);
    setResult(null);
    try {
      const data = await onboard({
        name: siteName.trim(),
        description: description.trim(),
        features,
        ambiance: inspirationType === 'preset' ? ambiance : undefined,
        image: inspirationType === 'image' ? (uploadedImage ?? undefined) : undefined,
        inspirationUrl: inspirationUrl.trim() || undefined,
        provider,
      });
      setResult(data.qualification);
      setCreatedSlug(data.site.slug);
      // Formulaire remis à zéro : un nouveau clic ne recrée pas le même site
      setSiteName('');
      setDescription('');
      setFeatures(NO_FEATURES);
      setUploadedImage(null);
      setInspirationUrl('');
      await refresh();
      toast.success(`Le site « ${data.site.name} » a été créé et rattaché à votre compte !`);
    } catch (err) {
      toast.error(err instanceof ApiError && err.status === 429 ? err.message : errorMessage(err, "Erreur lors de la génération IA."));
    } finally {
      refreshConfig(); // quota et offre à jour
      submitting.current = false;
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
            {quota !== null && (
              <div
                className="badge animate-slide"
                style={{
                  alignSelf: 'flex-start',
                  padding: '6px 12px',
                  fontSize: '0.85rem',
                  color: quotaExhausted ? 'var(--red-300)' : 'var(--indigo-200)',
                  borderColor: quotaExhausted ? 'rgba(244,63,94,0.4)' : 'var(--accent-blue-border)',
                }}
              >
                {quotaExhausted
                  ? `⛔ Quota IA journalier atteint (${quota.used}/${quota.limit}) — réinitialisation à minuit`
                  : `✨ ${quota.remaining} génération(s) IA restante(s) aujourd'hui (${quota.used}/${quota.limit} utilisées)`}
              </div>
            )}

            {config && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-muted)' }}>Modèle d'IA :</span>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {(Object.keys(PROVIDER_LABELS) as AiProvider[]).filter((p) => config.availableProviders[p]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setChosenProvider(p)}
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
                <InspirationImage value={uploadedImage} onChange={setUploadedImage} />
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

            <button className="btn btn-primary" onClick={handleSubmit} disabled={loading || quotaExhausted} style={{ width: '100%', padding: '14px 20px', fontSize: '1.05rem' }}>
              {loading ? '🧠 Analyse & génération par l\'IA…' :
               quotaExhausted ? '⛔ Quota IA journalier atteint' :
               '✨ Générer l\'ébauche & l\'architecture du site'}
            </button>
          </div>
        )}
      </div>

      {result && createdSlug && <OnboardingResult result={result} createdSlug={createdSlug} />}
    </div>
  );
}
