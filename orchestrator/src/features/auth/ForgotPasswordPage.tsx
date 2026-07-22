import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../../api/auth';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword(email);
      // Message identique que l'email existe ou non : pas d'énumération de comptes
      setSent(true);
    } catch {
      setError('Impossible de contacter le serveur. Réessayez dans un instant.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="glass-panel animate-slide" style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <div className="logo-icon" style={{ width: 52, height: 52, fontSize: '1.75rem' }}>M</div>
          <h1 style={{ fontSize: '1.4rem' }}>Mot de passe oublié</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Indiquez votre adresse email : nous vous enverrons un lien de réinitialisation.
          </p>
        </div>

        {sent ? (
          <div className="animate-slide" style={{ display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'center' }}>
            <div style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)', color: '#6ee7b7', borderRadius: 8, padding: '14px 16px', fontSize: '0.9rem' }}>
              ✓ Si un compte existe pour <strong>{email}</strong>, un email de réinitialisation vient de lui être envoyé.
              Pensez à vérifier vos courriers indésirables.
            </div>
            <Link to="/login" className="btn btn-secondary" style={{ textDecoration: 'none', alignSelf: 'center' }}>
              ← Retour à la connexion
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            <div>
              <label htmlFor="forgot-email" className="field-label">Adresse email</label>
              <input
                id="forgot-email"
                type="email"
                className="input-text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                autoComplete="email"
                required
                autoFocus
              />
            </div>

            {error && (
              <div className="animate-slide" style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.35)', color: '#fda4af', borderRadius: 8, padding: '10px 14px', fontSize: '0.875rem' }}>
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ padding: '13px 20px', fontSize: '1rem' }}>
              {submitting ? 'Envoi…' : 'Envoyer le lien de réinitialisation'}
            </button>

            <Link to="/login" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
              ← Retour à la connexion
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
