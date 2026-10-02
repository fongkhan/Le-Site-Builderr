import { useId } from 'react';
import { COMPACT_INPUT_STYLE, HINT_STYLE, INPUT_STYLE } from './styles';

interface TextFieldProps {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  /** Champ d'un élément de liste : sans libellé visible (libellé = placeholder + aria-label) */
  compact?: boolean;
}

// Champ texte libellé (label relié au champ) de l'éditeur de blocs.
export function TextField({ label, value, onChange, placeholder, multiline, rows, compact }: TextFieldProps) {
  const id = useId();
  const common = {
    id,
    className: 'input-text',
    style: compact ? COMPACT_INPUT_STYLE : INPUT_STYLE,
    value: value ?? '',
    placeholder: placeholder ?? (compact ? label : undefined),
    'aria-label': compact ? label : undefined,
  };
  const field = multiline ? (
    <textarea {...common} rows={rows} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input {...common} type="text" onChange={(e) => onChange(e.target.value)} />
  );
  if (compact) return field;
  return (
    <div>
      <label className="field-label" htmlFor={id}>{label}</label>
      {field}
    </div>
  );
}

// Note d'aide sous les champs d'un bloc.
export function FieldHint({ children }: { children: string }) {
  return <span className="field-label" style={HINT_STYLE}>{children}</span>;
}
