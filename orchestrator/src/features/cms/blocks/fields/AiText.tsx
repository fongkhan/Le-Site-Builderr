import { useId, useState } from 'react';
import { errorMessage } from '../../../../api/client';
import { useToast } from '../../../../components/ui/ToastContext';
import { useAiAssist } from '../../hooks/useAiAssist';
import { ICON_BUTTON_STYLE, INPUT_STYLE } from './styles';

interface AiTextFieldProps {
  label: string;
  siteSlug: string;
  value: string | undefined;
  /** Doit appliquer la valeur au bloc le plus récent (mise à jour fonctionnelle) */
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}

// Champ texte avec bouton « ✨ » : réécrit/améliore le contenu via l'assistant IA.
export function AiTextField({ label, siteSlug, value, onChange, multiline, placeholder }: AiTextFieldProps) {
  const id = useId();
  const toast = useToast();
  const ai = useAiAssist(siteSlug);
  const [busy, setBusy] = useState(false);

  const improve = async () => {
    if (!value || !value.trim()) {
      toast.info('Écrivez d’abord un texte, puis ✨ l’améliore.');
      return;
    }
    setBusy(true);
    try {
      const { text } = await ai.run('rewrite', value);
      if (text) {
        onChange(text);
        toast.success('Texte amélioré par l’IA.');
      }
    } catch (err) {
      toast.error(errorMessage(err, "L'assistant IA n'a pas pu répondre."));
    } finally {
      setBusy(false);
    }
  };

  const style = { ...INPUT_STYLE, flex: 1 };
  return (
    <div>
      <label className="field-label" htmlFor={id}>{label}</label>
      <div style={{ display: 'flex', gap: 6, alignItems: multiline ? 'flex-start' : 'center' }}>
        {multiline ? (
          <textarea id={id} className="input-text" style={style} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <input id={id} type="text" className="input-text" style={style} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        )}
        <button
          type="button"
          className="btn btn-secondary"
          style={ICON_BUTTON_STYLE}
          onClick={improve}
          disabled={busy || ai.disabledReason !== null}
          title={ai.disabledReason ?? "Améliorer ce texte avec l'IA"}
          aria-label={`Améliorer « ${label} » avec l'IA`}
        >
          {busy ? '…' : '✨'}
        </button>
      </div>
    </div>
  );
}
