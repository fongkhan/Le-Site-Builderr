import { useId, useRef, useState } from 'react';
import { uploadMedia } from '../../../../api/media';
import { ApiError, errorMessage } from '../../../../api/client';
import { useToast } from '../../../../components/ui/ToastContext';
import { COMPACT_INPUT_STYLE, ICON_BUTTON_STYLE } from './styles';

// Formats acceptés par la médiathèque (images matricielles : jamais de SVG, qui peut
// embarquer du script) et taille maximale, alignée sur MEDIA_MAX_MB côté serveur (8 Mo
// par défaut ; le serveur reste seul juge et répond 413 au-delà de sa propre limite).
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_UPLOAD_MB = 8;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const FORMAT_ERROR = 'Format refusé : choisissez une image PNG, JPEG, WebP ou GIF.';
const SIZE_ERROR = `Image trop volumineuse (${MAX_UPLOAD_MB} Mo maximum).`;

// Message lisible pour un refus du serveur (Payload répond en anglais).
function uploadErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 413) return SIZE_ERROR;
  if (err instanceof ApiError && err.status === 400) return FORMAT_ERROR;
  return errorMessage(err, 'Échec du téléversement.');
}

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
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error(FORMAT_ERROR);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(SIZE_ERROR);
      return;
    }
    setUploading(true);
    try {
      const { url } = await uploadMedia(siteSlug, file);
      onChange(url);
      toast.success('Image téléversée dans la médiathèque.');
    } catch (err) {
      toast.error(uploadErrorMessage(err));
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
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0])} />
      </div>
    </div>
  );
}
