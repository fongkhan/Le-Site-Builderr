import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Spinner } from '../../components/ui/Spinner';

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner label="Vérification de la session…" />
      </div>
    );
  }

  if (user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from || '/sites'} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from || '/sites', { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(
        message.includes('401') || /invalid|incorrect|email or password/i.test(message)
          ? 'Email ou mot de passe incorrect.'
          : message || 'Connexion impossible. Vérifiez que le serveur est démarré.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="glass-panel animate-slide" style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <div className="logo-icon" style={{ width: 52, height: 52, fontSize: '1.75rem' }}>M</div>
          <h1 className="logo-text" style={{ fontSize: '1.6rem' }}>MetaSite Builder</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Connectez-vous pour gérer vos sites web.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          <div>
            <label htmlFor="login-email" className="field-label">Adresse email</label>
            <input
              id="login-email"
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
          <div>
            <label htmlFor="login-password" className="field-label">Mot de passe</label>
            <input
              id="login-password"
              type="password"
              className="input-text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="animate-slide" style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.35)', color: '#fda4af', borderRadius: 8, padding: '10px 14px', fontSize: '0.875rem' }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ padding: '13px 20px', fontSize: '1rem' }}>
            {submitting ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>

        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
          Pas encore de compte ? Contactez votre administrateur : les comptes sont créés par l'équipe.
        </p>
      </div>
    </div>
  );
}
