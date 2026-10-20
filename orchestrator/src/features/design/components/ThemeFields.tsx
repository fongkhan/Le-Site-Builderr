import type { Dispatch, SetStateAction } from 'react';
import { toHex6 } from '../../../lib/color';
import type { Theme } from '../../../types';
import { ImageField } from '../../cms/blocks/fields/ImageField';
import { BODY_FONTS, COLOR_FIELDS, HEADING_FONTS, THEME_PRESETS, type ThemeErrors } from '../themeOptions';
import { ContrastWarnings } from './ContrastWarnings';

const ERROR_TEXT = { color: 'var(--accent-rose)', fontSize: '0.75rem', marginTop: 4, display: 'block' } as const;
const TEXT_INPUT = { background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', color: 'white', padding: '4px 8px', borderRadius: 4, width: '100%' } as const;
const HELP_TEXT = { color: 'var(--text-muted)', fontSize: '0.78rem', margin: 0 } as const;
const SECTION = { display: 'flex', flexDirection: 'column', gap: 15, borderTop: '1px solid var(--border-color)', paddingTop: 15 } as const;

// Attributs d'accessibilité d'un champ : message d'erreur relié (id) quand il est présent.
const errorProps = (error: string | undefined, id: string) =>
  error ? { 'aria-invalid': true as const, 'aria-describedby': id } : {};

// Police hors liste (thème ancien) : affichée telle quelle et signalée, jamais remplacée en silence
const fontOptions = (fonts: readonly string[], current: string) => (
  <>
    {!fonts.includes(current) && <option value={current} disabled>{current} (non disponible)</option>}
    {fonts.map((f) => <option key={f} value={f}>{f}</option>)}
  </>
);

interface ThemeFieldsProps {
  siteSlug: string;
  theme: Theme;
  errors: ThemeErrors | null;
  isModified: boolean;
  setTheme: Dispatch<SetStateAction<Theme>>;
}

// Champs de la page Design : identité (logo), palettes, couleurs (avec avertissements de
// lisibilité), polices et arrondis. Chaque erreur est reliée à son champ (aria-describedby).
export function ThemeFields({ siteSlug, theme, errors, isModified, setTheme }: ThemeFieldsProps) {
  const setColor = (key: keyof Theme['colors'], value: string) => setTheme((t) => ({ ...t, colors: { ...t.colors, [key]: value } }));
  // Logo vide = clé absente (pas de logo), comme le thème relu du serveur
  const setLogo = (value: string) =>
    setTheme((t) => {
      const next = { ...t };
      if (value) next.logo = value;
      else delete next.logo;
      return next;
    });

  return (
    <>
      <section aria-labelledby="theme-identite-titre" style={SECTION}>
        <h3 id="theme-identite-titre" style={{ fontSize: '1.1rem' }}>Identité du site</h3>
        <div>
          <ImageField
            siteSlug={siteSlug}
            label="Logo (en-tête du site et icône d'onglet)"
            placeholder="Téléversez votre logo avec 📤"
            value={theme.logo}
            onChange={setLogo}
            invalid={Boolean(errors?.logo)}
            describedBy={errors?.logo ? 'theme-logo-erreur theme-logo-aide' : 'theme-logo-aide'}
          />
          {errors?.logo && <span id="theme-logo-erreur" style={ERROR_TEXT}>{errors.logo}</span>}
        </div>
        <p id="theme-logo-aide" style={HELP_TEXT}>
          Sans logo, le nom du site s'affiche dans l'en-tête et l'icône d'onglet reprend son initiale aux couleurs du thème. Formats : PNG, JPEG, WebP, GIF ou AVIF (SVG refusé).
        </p>
        {theme.logo && (
          <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start', padding: '5px 10px', fontSize: '0.8rem' }} onClick={() => setLogo('')}>
            Retirer le logo
          </button>
        )}
      </section>

      <section aria-labelledby="theme-variables-titre" style={SECTION}>
        <h3 id="theme-variables-titre" style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          Variables du thème
          {isModified && (
            <span className="badge animate-slide" style={{ background: 'rgba(244, 63, 94, 0.15)', borderColor: 'rgba(244, 63, 94, 0.3)', color: '#fda4af', fontWeight: 600, fontSize: '0.75rem' }}>
              ⚠️ Brouillon non sauvegardé
            </span>
          )}
        </h3>

        <div>
          <span className="field-label" id="theme-palettes">Palettes prêtes à l'emploi</span>
          <div role="group" aria-labelledby="theme-palettes" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {THEME_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className="btn btn-secondary"
                style={{ padding: '5px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6 }}
                // Une palette change couleurs, polices et arrondis : le logo est conservé
                onClick={() => setTheme((t) => ({ ...structuredClone(preset.theme), ...(t.logo ? { logo: t.logo } : {}) }))}
                title={`Appliquer la palette « ${preset.name} »`}
              >
                <span aria-hidden="true" style={{ display: 'inline-flex', gap: 2 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: preset.theme.colors.primary, display: 'inline-block' }} />
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: preset.theme.colors.secondary, display: 'inline-block' }} />
                </span>
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {COLOR_FIELDS.map(({ key, label }) => {
            const error = errors?.colors[key];
            const errorId = `theme-color-${key}-erreur`;
            return (
              <div key={key}>
                <label className="field-label" htmlFor={`theme-color-${key}`}>{label}</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {/* Le sélecteur natif n'accepte que #rrggbb : #RGB / #RRGGBBAA y sont normalisés */}
                  <input
                    type="color"
                    aria-label={`${label} (sélecteur)`}
                    value={toHex6(theme.colors[key].trim())}
                    onChange={(e) => setColor(key, e.target.value)}
                    style={{ border: 'none', background: 'none', width: 32, height: 32, cursor: 'pointer' }}
                  />
                  <input
                    id={`theme-color-${key}`}
                    type="text"
                    value={theme.colors[key]}
                    {...errorProps(error, errorId)}
                    onChange={(e) => setColor(key, e.target.value)}
                    style={{ ...TEXT_INPUT, borderColor: error ? 'var(--accent-rose)' : 'var(--border-color)' }}
                  />
                </div>
                {error && <span id={errorId} style={ERROR_TEXT}>{error}</span>}
              </div>
            );
          })}
        </div>

        {/* Lisibilité calculée en direct (jamais bloquante) */}
        <ContrastWarnings theme={theme} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label className="field-label" htmlFor="theme-font-heading">Police des titres</label>
            <select
              id="theme-font-heading"
              className="select-dark"
              value={theme.fonts.heading}
              {...errorProps(errors?.heading, 'theme-font-heading-erreur')}
              onChange={(e) => setTheme((t) => ({ ...t, fonts: { ...t.fonts, heading: e.target.value } }))}
            >
              {fontOptions(HEADING_FONTS, theme.fonts.heading)}
            </select>
            {errors?.heading && <span id="theme-font-heading-erreur" style={ERROR_TEXT}>{errors.heading}</span>}
          </div>
          <div>
            <label className="field-label" htmlFor="theme-font-body">Police du corps</label>
            <select
              id="theme-font-body"
              className="select-dark"
              value={theme.fonts.body}
              {...errorProps(errors?.body, 'theme-font-body-erreur')}
              onChange={(e) => setTheme((t) => ({ ...t, fonts: { ...t.fonts, body: e.target.value } }))}
            >
              {fontOptions(BODY_FONTS, theme.fonts.body)}
            </select>
            {errors?.body && <span id="theme-font-body-erreur" style={ERROR_TEXT}>{errors.body}</span>}
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="theme-radius">Bordures arrondies (border-radius)</label>
          <input
            id="theme-radius"
            type="text"
            value={theme.radius}
            {...errorProps(errors?.radius, 'theme-radius-erreur')}
            onChange={(e) => setTheme((t) => ({ ...t, radius: e.target.value }))}
            style={{ ...TEXT_INPUT, padding: 8, borderColor: errors?.radius ? 'var(--accent-rose)' : 'var(--border-color)' }}
            placeholder="ex : 8px, 12px, 0"
          />
          {errors?.radius && <span id="theme-radius-erreur" style={ERROR_TEXT}>{errors.radius}</span>}
        </div>
      </section>
    </>
  );
}
