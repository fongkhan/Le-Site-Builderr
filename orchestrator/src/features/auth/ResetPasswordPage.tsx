import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword } from '../../api/auth';
import { useToast } from '../../components/ui/ToastContext';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(token!, password);
      toast.success('Mot de passe mis à jour : vous pouvez vous connecter.');
      navigate('/login', { replace: true });
    } catch {
      setError('Ce lien de réinitialisation est invalide ou a expiré. Demandez-en un nouveau.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="glass-panel animate-slide" style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <div className="logo-icon" style={{ width: 52, height: 52, fontSize: '1.75rem' }}>M</div>
          <h1 style={{ fontSize: '1.4rem' }}>Nouveau mot de passe</h1>
        </div>

        {!token ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'center' }}>
            <div style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.35)', color: '#fda4af', borderRadius: 8, padding: '14px 16px', fontSize: '0.9rem' }}>
              Lien de réinitialisation incomplet : le jeton est manquant.
            </div>
            <Link to="/forgot-password" className="btn btn-primary" style={{ textDecoration: 'none', alignSelf: 'center' }}>
              Demander un nouveau lien
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            <div>
              <label htmlFor="reset-password" className="field-label">Nouveau mot de passe</label>
              <input
                id="reset-password"
                type="password"
                className="input-text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8 caractères minimum"
                autoComplete="new-password"
                required
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="reset-confirm" className="field-label">Confirmez le mot de passe</label>
              <input
                id="reset-confirm"
                type="password"
                className="input-text"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
            </div>

            {error && (
              <div className="animate-slide" style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.35)', color: '#fda4af', borderRadius: 8, padding: '10px 14px', fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span>{error}</span>
                {error.includes('expiré') && (
                  <Link to="/forgot-password" style={{ color: '#fda4af', fontWeight: 600 }}>
                    → Demander un nouveau lien
                  </Link>
                )}
              </div>
            )}

            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ padding: '13px 20px', fontSize: '1rem' }}>
              {submitting ? 'Mise à jour…' : 'Définir le nouveau mot de passe'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
