import { STACK_OPTIONS } from './constants';

// Sélecteur de stack : une valeur inconnue (site ancien, import) reste affichée et
// sélectionnée telle quelle au lieu d'être silencieusement remplacée.
export function StackSelect({ value, onChange, compact = false }: { value: string; onChange: (v: string) => void; compact?: boolean }) {
  const known = STACK_OPTIONS.some((o) => o.value === value);
  return (
    <select
      className="select-dark"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={compact ? undefined : { padding: 10, fontSize: '0.9rem' }}
    >
      {!known && value && <option value={value}>{value}</option>}
      {STACK_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
