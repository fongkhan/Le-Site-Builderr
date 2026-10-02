// Indicateur de chargement annoncé aux lecteurs d'écran (role="status").
export function Spinner({ label }: { label?: string }) {
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)' }}>
      <span className="spinner" aria-hidden />
      {label ? <span style={{ fontSize: '0.9rem' }}>{label}</span> : <span className="sr-only">Chargement…</span>}
    </div>
  );
}
