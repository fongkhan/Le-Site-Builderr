import type { BlockPreviewProps } from '../types';
import { formFieldStyle, headingStyle } from './previewStyles';

// Reproduit client-template/src/components/blocks/Appointment.astro (formulaire inactif).
export function AppointmentPreview({ block, theme }: BlockPreviewProps) {
  const field = formFieldStyle(theme);
  const services = (block.services ?? []).map((s) => s?.name).filter((name): name is string => Boolean(name && name.trim()));
  return (
    <div style={{ padding: '50px 20px', backgroundColor: theme.colors.background }}>
      <h2 style={headingStyle(theme)}>{block.title || 'Prendre rendez-vous'}</h2>
      {block.subtitle && <p style={{ textAlign: 'center', marginBottom: 20, opacity: 0.85 }}>{block.subtitle}</p>}
      <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input disabled placeholder="Votre nom" aria-label="Votre nom" style={field} />
        <input disabled placeholder="Votre email" aria-label="Votre email" style={field} />
        <input disabled placeholder="Votre téléphone" aria-label="Votre téléphone" style={field} />
        {services.length > 0 && (
          <select disabled aria-label="Prestation souhaitée" style={field} defaultValue="">
            <option value="">Prestation souhaitée… ({services.join(', ')})</option>
          </select>
        )}
        <input disabled placeholder="Créneau souhaité (ex. mardi après-midi)" aria-label="Créneau souhaité" style={field} />
        <textarea disabled placeholder="Précisions (facultatif)…" aria-label="Précisions" rows={3} style={field} />
        <button type="button" disabled style={{ backgroundColor: theme.colors.primary, color: '#fff', border: 'none', borderRadius: theme.radius, padding: '10px 20px', fontWeight: 600 }}>
          {block.ctaText || 'Demander un rendez-vous'}
        </button>
      </div>
    </div>
  );
}
