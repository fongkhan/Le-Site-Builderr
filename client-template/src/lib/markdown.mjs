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

// Applique gras / italique / liens sur du texte DÉJÀ échappé.
function inline(escaped) {
  let out = escaped;
  // Liens [texte](url) — uniquement http(s)/mailto (après échappement, "://" est intact)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    (_m, text, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`);
  // Gras **texte**
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italique *texte* (traité après le gras)
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  return out;
}

export function markdownToHtml(md) {
  if (!md) return '';
  const escaped = escapeHtml(String(md));
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
