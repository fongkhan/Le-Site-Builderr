import type { AutosaveState } from '../hooks/autosaveController';

const PILL = { fontSize: '0.8rem', whiteSpace: 'nowrap' } as const;

// État de la sauvegarde automatique. Les échecs restent affichés (avec « Réessayer »)
// tant que le contenu n'a pas pu être enregistré.
export function SaveIndicator({ state, onRetry }: { state: AutosaveState; onRetry: () => void }) {
  switch (state.status) {
    case 'saving':
      return <span style={{ ...PILL, color: 'var(--accent-blue)' }}>💾 Enregistrement…</span>;
    case 'pending':
      return <span style={{ ...PILL, color: 'var(--amber-400)' }}>● Modifications en attente</span>;
    case 'retrying':
    case 'error': {
      const refused = state.status === 'error';
      return (
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '8px 10px',
            borderRadius: 8,
            fontSize: '0.8rem',
            border: `1px solid ${refused ? 'rgba(244, 63, 94, 0.4)' : 'rgba(251, 191, 36, 0.4)'}`,
            background: refused ? 'rgba(244, 63, 94, 0.08)' : 'rgba(251, 191, 36, 0.08)',
            color: refused ? 'var(--red-300)' : 'var(--amber-400)',
          }}
        >
          <span>
            {refused ? '⛔ Enregistrement refusé' : '⚠️ Échec de l’enregistrement'}
            {state.error ? ` : ${state.error}` : ''}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            {refused
              ? 'Vos dernières modifications ne sont pas enregistrées. Corrigez le contenu (elles seront renvoyées automatiquement) ou réessayez.'
              : `Nouvel essai automatique dans ${Math.max(1, Math.round((state.retryInMs ?? 0) / 1000))} s.`}
          </span>
          <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem', alignSelf: 'flex-start' }} onClick={onRetry}>
            Réessayer maintenant
          </button>
        </div>
      );
    }
    default:
      return <span style={{ ...PILL, color: 'var(--accent-emerald)' }}>✓ Enregistré</span>;
  }
}
