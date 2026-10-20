import { useId } from 'react';
import type { UpdateOptions } from '../types';
import { isBlogArticlePath, linkHint, linkMode, normalizePagePath, type LinkTargets } from '../../lib/ctaLink';
import { COMPACT_INPUT_STYLE, HINT_STYLE, INPUT_STYLE } from './styles';

interface LinkFieldProps {
  label: string;
  /** Valeur enregistrée (null possible à la lecture d'un ancien contenu) */
  value: string | null | undefined;
  /** undefined : mode Automatique (champ retiré) */
  onChange: (value: string | undefined, options?: UpdateOptions) => void;
  /** Pages et formulaires proposés ; sans cibles, la syntaxe seule est contrôlée */
  targets?: LinkTargets;
  /** Champ d'un élément de liste : sans libellé visible (aria-label) */
  compact?: boolean;
}

// Valeurs réservées du sélecteur : choix d'un type de lien saisi à la main
const WEB = '__web';
const TEL = '__tel';
const EMAIL = '__email';

const IMMEDIATE: UpdateOptions = { immediate: true };

// Lien d'un bouton d'action : Automatique (formulaire du site), formulaire de la page,
// page du site, adresse web, téléphone ou email. Le choix est enregistré tout de suite ;
// la saisie (adresse, numéro) suit la sauvegarde différée de la frappe.
export function LinkField({ label, value, onChange, targets, compact }: LinkFieldProps) {
  const id = useId();
  const hintId = `${id}-indication`;
  const current = typeof value === 'string' ? value : '';
  // Blancs initiaux ignorés (comme le template) ; les finaux restent pendant la frappe
  const typed = current.replace(/^\s+/, '');
  const mode = linkMode(current);
  const anchors = targets?.anchors ?? [];
  const pages = targets?.pages ?? [];

  let selected = '';
  let unknown: string | null = null;
  let unknownLabel = '';
  if (mode === 'web') selected = WEB;
  else if (mode === 'tel') selected = TEL;
  else if (mode === 'email') selected = EMAIL;
  else if (mode === 'anchor' || mode === 'page') {
    const raw = current.trim();
    const normalized = mode === 'page' ? normalizePagePath(raw) : raw;
    const known = [...anchors, ...pages].find((t) => t.href === normalized);
    selected = known ? known.href : raw;
    if (!known) {
      unknown = raw;
      // Article du blog : lien valide, jamais proposé dans les cibles (pas d'avertissement)
      if (mode === 'page' && isBlogArticlePath(raw)) unknownLabel = `Article du blog : ${raw}`;
      else unknownLabel = targets ? `⚠️ Lien introuvable : ${raw}` : `Lien : ${raw}`;
    }
  }

  const hint = linkHint(current, targets);
  const describedBy = hint ? hintId : undefined;
  const style = compact ? COMPACT_INPUT_STYLE : INPUT_STYLE;

  const choose = (choice: string) => {
    if (choice === '') onChange(undefined, IMMEDIATE);
    else if (choice === WEB) onChange(mode === 'web' ? current : 'https://', IMMEDIATE);
    else if (choice === TEL) onChange('tel:', IMMEDIATE);
    else if (choice === EMAIL) onChange('mailto:', IMMEDIATE);
    else onChange(choice, IMMEDIATE);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {!compact && <label className="field-label" htmlFor={id} style={{ marginBottom: 0 }}>{label}</label>}
      <select
        id={id}
        className="select-dark"
        style={style}
        value={selected}
        aria-label={compact ? label : undefined}
        aria-describedby={describedBy}
        onChange={(e) => choose(e.target.value)}
      >
        <option value="">Automatique : formulaire de contact ou de rendez-vous</option>
        {anchors.length > 0 && (
          <optgroup label="Sur cette page">
            {anchors.map((a) => <option key={a.href} value={a.href}>{a.label}</option>)}
          </optgroup>
        )}
        {targets && (
          <optgroup label="Pages du site">
            {pages.map((p) => <option key={p.href} value={p.href}>{p.label}</option>)}
          </optgroup>
        )}
        {unknown !== null && (
          <option value={unknown}>{unknownLabel}</option>
        )}
        <optgroup label="Autre lien">
          <option value={WEB}>Adresse web (https://…)</option>
          <option value={TEL}>Numéro de téléphone</option>
          <option value={EMAIL}>Adresse email</option>
        </optgroup>
      </select>
      {mode === 'web' && (
        <input
          type="url"
          className="input-text"
          style={style}
          value={current}
          placeholder="https://www.exemple.fr/reservation"
          aria-label="Adresse web du bouton"
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value || 'https://')}
        />
      )}
      {mode === 'tel' && (
        <input
          type="tel"
          className="input-text"
          style={style}
          value={typed.slice(4)}
          placeholder="04 78 00 00 00"
          aria-label="Numéro de téléphone du bouton"
          aria-describedby={describedBy}
          onChange={(e) => onChange(`tel:${e.target.value}`)}
        />
      )}
      {mode === 'email' && (
        <input
          type="email"
          className="input-text"
          style={style}
          value={typed.slice(7)}
          placeholder="contact@exemple.fr"
          aria-label="Adresse email du bouton"
          aria-describedby={describedBy}
          onChange={(e) => onChange(`mailto:${e.target.value.trim()}`)}
        />
      )}
      {hint && (
        <span id={hintId} className="field-label" style={hint.warning ? { ...HINT_STYLE, color: 'var(--amber-400)', marginBottom: 0 } : { ...HINT_STYLE, marginBottom: 0 }}>
          {hint.warning ? `⚠️ ${hint.text}` : hint.text}
        </span>
      )}
    </div>
  );
}
