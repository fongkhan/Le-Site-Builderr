import { useNavigate } from 'react-router-dom';
import type { OnboardingResult as Qualification } from '../../types';

// Résultat de l'onboarding : spécifications déduites et prochaines étapes.
export function OnboardingResult({ result, createdSlug }: { result: Qualification; createdSlug: string }) {
  const navigate = useNavigate();
  return (
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
          <li><strong>Blog</strong> — publiez vos premières actualités (facultatif).</li>
          <li><strong>Déploiement</strong> — publiez le site en un clic.</li>
        </ol>
        <button className="btn btn-primary" style={{ marginTop: 'auto' }} onClick={() => navigate(`/sites/${encodeURIComponent(createdSlug)}/design`)}>
          Étape suivante : personnaliser le design →
        </button>
      </div>
    </div>
  );
}
