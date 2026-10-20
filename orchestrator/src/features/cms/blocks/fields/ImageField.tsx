import { useId, useRef, useState } from 'react';
import { uploadMedia } from '../../../../api/media';
import { useToast } from '../../../../components/ui/ToastContext';
import { useConfig } from '../../../../state/ConfigContext';
import { COMPACT_INPUT_STYLE, ICON_BUTTON_STYLE } from './styles';
import { ACCEPTED_TYPES, FORMAT_ERROR, exceedsUploadLimit, sizeErrorMessage, uploadErrorMessage, uploadLimitMb } from './uploadPolicy';

interface ImageFieldProps {
  siteSlug: string;
  value: string | undefined;
  placeholder?: string;
  /** Appelé aussi APRÈS un téléversement : doit viser la dernière version du contenu */
  onChange: (url: string) => void;
  /** Libellé visible au-dessus du champ */
  label?: string;
  /** Libellé accessible quand aucun libellé n'est visible */
  ariaLabel?: string;
}

// Champ image : URL libre OU téléversement dans la médiathèque du site (bouton 📤).
// Aussi utilisé par le blog (features/blog/PostEditor.tsx, via ../cms/BlockEditor).
export function ImageField({ siteSlug, value, placeholder, onChange, label, ariaLabel }: ImageFieldProps) {
  const id = useId();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  // Limite annoncée par le serveur (MEDIA_MAX_MB) ; inconnue → le serveur seul en juge
  const limitMb = uploadLimitMb(useConfig().config?.mediaMaxMb);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error(FORMAT_ERROR);
      return;
    }
    if (exceedsUploadLimit(file.size, limitMb)) {
      toast.error(sizeErrorMessage(limitMb));
      return;
    }
    setUploading(true);
    try {
      const { url } = await uploadMedia(siteSlug, file);
      onChange(url);
      toast.success('Image téléversée dans la médiathèque.');
    } catch (err) {
      toast.error(uploadErrorMessage(err, limitMb));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div>
      {label && <label className="field-label" htmlFor={id}>{label}</label>}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          id={id}
          type="text"
          className="input-text"
          style={{ ...COMPACT_INPUT_STYLE, flex: 1 }}
          placeholder={placeholder || 'URL de l’image ou 📤'}
          aria-label={label ? undefined : ariaLabel ?? placeholder ?? 'URL de l’image'}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-secondary"
          style={ICON_BUTTON_STYLE}
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Téléverser une image dans la médiathèque du site"
          aria-label="Téléverser une image"
        >
          {uploading ? '…' : '📤'}
        </button>
        <input ref={fileRef} type="file" accept={ACCEPTED_TYPES.join(',')} style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0])} />
      </div>
    </div>
  );
}
