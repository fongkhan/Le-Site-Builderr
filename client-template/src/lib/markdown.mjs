// Mini-markdown → HTML, sûr par construction : on échappe tout le HTML AVANT d'appliquer
// un sous-ensemble volontairement restreint (titres, gras, italique, listes, liens,
// paragraphes). Aucune balise brute de l'utilisateur n'est conservée → pas d'XSS.
// Fonction pure (chaîne → chaîne) : testable sans DOM.

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Gras **texte** : un caractère non blanc juste après l'ouverture et juste avant la
// fermeture (« 5 ** 2 » n'est pas du gras). Le contenu peut contenir de l'italique
// (*…*) ; la fermeture ne doit pas être suivie d'une 3e étoile (« ***x*** » → gras +
// italique correctement imbriqués).
const BOLD_RE = /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*(?!\*)/g;
// Italique *texte* : mêmes contraintes de non-blanc, et pas au milieu d'un mot
// (« 2*3*4 » reste tel quel). Traité après le gras.
const ITALIC_RE = /(^|[^*\p{L}\p{N}])\*(?=[^\s*])([^*]*?[^\s*])\*(?![*\p{L}\p{N}])/gu;
// Liens [texte](url) — uniquement http(s)/mailto (après échappement, « :// » est intact).
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g;
// Jeton de remplacement des liens (le caractère NUL est retiré de l'entrée).
const TOKEN_RE = /\u0000(\d+)\u0000/g;

// Balises <strong> équilibrées dans un fragment (évite un italique qui chevaucherait
// un gras : « **a *b** c* » est laissé tel quel plutôt que mal imbriqué).
function balancedStrong(fragment) {
  return (fragment.match(/<strong>/g) || []).length === (fragment.match(/<\/strong>/g) || []).length;
}

// Gras puis italique sur du texte DÉJÀ échappé et sans lien.
function emphasis(text) {
  return text
    .replace(BOLD_RE, '<strong>$1</strong>')
    .replace(ITALIC_RE, (m, before, inner) => (balancedStrong(inner) ? `${before}<em>${inner}</em>` : m));
}

// Applique liens / gras / italique sur du texte DÉJÀ échappé. Les liens sont d'abord
// remplacés par des jetons : leurs URLs ne sont jamais touchées par le gras/italique
// (une « * » dans un href restait sinon transformée en <em>).
function inline(escaped) {
  const links = [];
  const tokenized = escaped.replace(LINK_RE, (_m, text, url) => {
    links.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${emphasis(text)}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  return emphasis(tokenized).replace(TOKEN_RE, (_m, i) => links[Number(i)]);
}

export function markdownToHtml(md) {
  if (!md) return '';
  const escaped = escapeHtml(String(md).replace(/\u0000/g, ''));
  const lines = escaped.split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let listItems = [];

  const flushParagraph = () => {
    if (paragraph.length) { html.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; }
  };
  const flushList = () => {
    if (listItems.length) { html.push(`<ul>${listItems.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`); listItems = []; }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') { flushParagraph(); flushList(); continue; }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph(); flushList();
      const level = heading[1].length + 1; // # → h2, ## → h3, ### → h4
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) { flushParagraph(); listItems.push(bullet[1]); continue; }

    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return html.join('\n');
}
