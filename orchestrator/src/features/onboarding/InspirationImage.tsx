import type { ChangeEvent } from 'react';
import { useToast } from '../../components/ui/ToastContext';

// Formats acceptés tels quels par le serveur ; les autres (SVG, HEIC…) sont convertis.
const DIRECT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
// Borne l'upload : taille ≤ 4 Mo, redimensionnement canvas (≤ 1200 px, JPEG 0.85) pour
// ne pas envoyer un data-URL énorme à l'IA. Les petits logos PNG sont conservés tels
// quels (transparence préservée).
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_DIMENSION = 1200;

// Zone de dépôt de l'image/logo d'inspiration (glisser-déposer ou sélection).
export function InspirationImage({ value, onChange }: { value: string | null; onChange: (dataUrl: string | null) => void }) {
  const toast = useToast();

  const readImage = (file: File) => {
    // Type réel image/* : ferme le contournement du glisser-déposer que `accept` ne bloque pas
    if (!file.type.startsWith('image/')) {
      toast.error('Veuillez fournir un fichier image (PNG, JPEG, WebP…).');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('Image trop volumineuse (4 Mo maximum). Choisissez un fichier plus léger.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error('Impossible de lire ce fichier image.');
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onerror = () => toast.error('Ce fichier image semble corrompu ou dans un format non pris en charge.');
      img.onload = () => {
        const needsResize = img.width > MAX_DIMENSION || img.height > MAX_DIMENSION;
        const heavy = file.size > 1024 * 1024;
        if (!needsResize && !heavy && DIRECT_TYPES.has(file.type)) {
          onChange(dataUrl); // déjà légère et dans un format accepté : on garde l'original
          return;
        }
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width || MAX_DIMENSION, img.height || MAX_DIMENSION));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((img.width || MAX_DIMENSION) * scale));
        canvas.height = Math.max(1, Math.round((img.height || MAX_DIMENSION) * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          toast.error("Impossible de préparer cette image : essayez un PNG ou un JPEG.");
          return;
        }
        ctx.fillStyle = '#ffffff'; // fond blanc : le JPEG n'a pas d'alpha (logos transparents)
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        onChange(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readImage(file);
    e.target.value = '';
  };

  return (
    <div
      style={{
        border: '2px dashed var(--border-color)',
        borderRadius: 8,
        padding: '20px 10px',
        textAlign: 'center',
        cursor: 'pointer',
        background: 'rgba(255,255,255,0.01)',
        position: 'relative',
        borderColor: value ? 'var(--accent-blue)' : 'var(--border-color)',
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) readImage(file);
      }}
    >
      <input
        type="file"
        accept="image/*"
        aria-label="Choisir une image ou un logo d'inspiration"
        onChange={handleImageUpload}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
      />
      {value ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <img src={value} alt="Inspiration" style={{ maxHeight: 70, borderRadius: 4, objectFit: 'contain' }} />
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Image d'inspiration chargée.</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            className="btn btn-secondary"
            style={{ padding: '4px 8px', fontSize: '0.75rem', zIndex: 10, position: 'relative', borderColor: 'rgba(244, 63, 94, 0.4)', color: 'var(--red-300)' }}
          >
            Supprimer
          </button>
        </div>
      ) : (
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Glissez-déposez une image / un logo ici, ou cliquez pour choisir
        </span>
      )}
    </div>
  );
}
