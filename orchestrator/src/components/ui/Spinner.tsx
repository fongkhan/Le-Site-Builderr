export function Spinner({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)' }}>
      <span className="spinner" aria-hidden />
      {label && <span style={{ fontSize: '0.9rem' }}>{label}</span>}
    </div>
  );
}
