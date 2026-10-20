// Audit d'accessibilité des formulaires sur le HTML rendu par renderToString (tests
// Vitest sans DOM ; eslint-plugin-jsx-a11y n'est pas compatible avec ESLint 10).
// React échappe « > » dans les valeurs d'attribut : une balise se lit donc d'un seul
// tenant jusqu'au premier « > ».

interface Tag {
  name: string;
  closing: boolean;
  attrs: Map<string, string>;
}

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
const ATTR_RE = /([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const CONTROLS = new Set(['input', 'select', 'textarea']);
// Champs nommés par leur valeur ou sans nom requis
const UNNAMED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset']);

function parseAttrs(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of source.matchAll(ATTR_RE)) attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

function tags(html: string): Tag[] {
  return [...html.matchAll(TAG_RE)].map((m) => ({ name: m[2].toLowerCase(), closing: m[1] === '/', attrs: parseAttrs(m[3]) }));
}

const tagLabel = (tag: Tag) => {
  const id = tag.attrs.get('id');
  const type = tag.attrs.get('type');
  return `<${tag.name}${type ? ` type="${type}"` : ''}${id ? ` id="${id}"` : ''}>`;
};

const isHiddenFileInput = (tag: Tag) =>
  tag.attrs.get('type') === 'file' && /display\s*:\s*none/i.test(tag.attrs.get('style') ?? '');

/**
 * Champs (input, select, textarea) sans nom accessible, <label> orphelins, références
 * (for, aria-labelledby, aria-describedby) vers un id absent. Liste vide = conforme.
 * Nom accessible : <label for> relié, champ imbriqué dans un <label>, aria-label non
 * vide ou aria-labelledby valide. Ignorés : input hidden, input file en display:none.
 */
export function auditFormControls(html: string): string[] {
  const all = tags(html);
  const ids = new Set(all.filter((t) => !t.closing && t.attrs.has('id')).map((t) => t.attrs.get('id')!));
  const labelFor = new Set(all.filter((t) => !t.closing && t.name === 'label' && t.attrs.get('for')).map((t) => t.attrs.get('for')!));
  const problems: string[] = [];

  const missingRefs = (tag: Tag, attr: string) => {
    const value = tag.attrs.get(attr);
    if (value === undefined) return;
    const refs = value.split(/\s+/).filter(Boolean);
    if (refs.length === 0) problems.push(`${tagLabel(tag)} : ${attr} vide`);
    for (const ref of refs) if (!ids.has(ref)) problems.push(`${tagLabel(tag)} : ${attr} vers un id absent (« ${ref} »)`);
  };

  // Label ouvert (et s'il contient un champ) pendant le parcours
  let openLabel: { tag: Tag; hasControl: boolean } | null = null;
  for (const tag of all) {
    if (tag.name === 'label') {
      if (!tag.closing) {
        openLabel = { tag, hasControl: false };
        const target = tag.attrs.get('for');
        if (target !== undefined && !ids.has(target)) problems.push(`<label> : for vers un id absent (« ${target} »)`);
      } else if (openLabel) {
        if (!openLabel.tag.attrs.get('for') && !openLabel.hasControl) problems.push('<label> orphelin : ni « for » ni champ imbriqué');
        openLabel = null;
      }
      continue;
    }
    if (tag.closing) continue;
    missingRefs(tag, 'aria-describedby');
    missingRefs(tag, 'aria-labelledby');
    if (!CONTROLS.has(tag.name)) continue;
    if (tag.name === 'input' && (UNNAMED_INPUT_TYPES.has(tag.attrs.get('type') ?? '') || isHiddenFileInput(tag))) continue;
    if (openLabel) openLabel.hasControl = true;
    const id = tag.attrs.get('id');
    const named =
      (id !== undefined && labelFor.has(id)) ||
      openLabel !== null ||
      (tag.attrs.get('aria-label') ?? '').trim() !== '' ||
      ((tag.attrs.get('aria-labelledby') ?? '').trim() !== '' && tag.attrs.get('aria-labelledby')!.split(/\s+/).filter(Boolean).every((ref) => ids.has(ref)));
    if (!named) problems.push(`${tagLabel(tag)} sans nom accessible`);
  }
  return problems;
}

/**
 * Structure d'un formulaire : exactement un <form> avec novalidate (validation en ligne),
 * exactement un bouton de soumission, aucun <button> sans type (un bouton sans type
 * soumettrait le formulaire). Liste vide = conforme.
 */
export function auditForm(html: string): string[] {
  const all = tags(html).filter((t) => !t.closing);
  const problems: string[] = [];
  const forms = all.filter((t) => t.name === 'form');
  if (forms.length !== 1) problems.push(`${forms.length} <form> au lieu d'un seul`);
  else if (!forms[0].attrs.has('novalidate')) problems.push('<form> sans novalidate');
  const submits = all.filter((t) => (t.name === 'button' || t.name === 'input') && t.attrs.get('type') === 'submit');
  if (submits.length !== 1) problems.push(`${submits.length} bouton(s) de soumission au lieu d'un seul`);
  for (const button of all.filter((t) => t.name === 'button' && !t.attrs.has('type'))) {
    problems.push(`${tagLabel(button)} sans type`);
  }
  return problems;
}
