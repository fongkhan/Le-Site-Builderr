// Mentions légales, politique de confidentialité et mention RGPD des formulaires (fixture :
// clé « legal », page CMS fr/mentions-legales prioritaire, langues fr et en).
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ dist, base, htmlFiles, readDist, check }) {
  // 1. Pages générées (une page CMS n'occupe pas leur adresse)
  for (const [rel, kind] of [['confidentialite/index.html', 'privacy'], ['en/legal-notice/index.html', 'notice'], ['en/privacy-policy/index.html', 'privacy']]) {
    const html = readDist(rel);
    check(html !== '', `page légale absente : ${rel}`);
    check(html.includes(`data-legal-page="${kind}"`), `${rel} : page légale « ${kind} » non générée par le template`);
  }

  // 2. Page du CMS à la même adresse : conservée, jamais remplacée
  const cmsNotice = readDist('mentions-legales/index.html');
  check(cmsNotice !== '', 'page CMS mentions-legales/index.html absente');
  check(!cmsNotice.includes('data-legal-page'), 'mentions-legales/index.html : la page générée a remplacé la page du CMS');

  const links = {
    fr: { notice: `${base}/mentions-legales/`, privacy: `${base}/confidentialite/` },
    en: { notice: `${base}/en/legal-notice/`, privacy: `${base}/en/privacy-policy/` },
  };
  for (const file of htmlFiles) {
    const rel = path.relative(dist, file).split(path.sep).join('/');
    const html = fs.readFileSync(file, 'utf-8');
    const lang = rel.startsWith('en/') ? 'en' : 'fr';

    // 3. Liens légaux en bas de chaque page (404 et blog compris), préfixés par la base
    const nav = html.match(/<nav class="legal-links"[^>]*>([\s\S]*?)<\/nav>/);
    check(Boolean(nav), `${rel} : liens légaux (<nav class="legal-links">) absents`);
    if (nav) {
      check(nav[1].includes(`href="${links[lang].notice}"`), `${rel} : lien vers les mentions légales (${links[lang].notice}) absent`);
      check(nav[1].includes(`href="${links[lang].privacy}"`), `${rel} : lien vers la politique de confidentialité (${links[lang].privacy}) absent`);
    }

    // 4. Mention RGPD sous chaque formulaire : politique de sa langue, durée de conservation,
    //    réponse sans JavaScript dans la langue de la page
    for (const [form] of html.matchAll(/<form class="lead-form"[\s\S]*?<\/form>/g)) {
      check(form.includes(`href="${links[lang].privacy}"`), `${rel} : formulaire sans lien vers ${links[lang].privacy}`);
      check(form.includes(lang === 'en' ? '12 months' : '12 mois'), `${rel} : durée de conservation absente sous le formulaire`);
      const action = (form.match(/\saction="([^"]*)"/) || [])[1] || '';
      check(action.endsWith(`?lang=${lang}`), `${rel} : action du formulaire sans ?lang=${lang} (${action})`);
    }

    // 5. Saisie hostile : jamais interprétée
    check(!html.includes('<script>alert(1)'), `${rel} : saisie légale hostile interprétée (<script>alert(1))`);
    // 6. Site publié : aucun champ signalé « À compléter »
    check(!html.includes('À compléter') && !html.includes('To be completed'), `${rel} : « À compléter » sur le site publié`);
  }

  const privacy = readDist('confidentialite/index.html');
  check(privacy.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'confidentialite/index.html : raison sociale non affichée en texte échappé');
  // 7. Lien vers la CNIL
  check(privacy.includes('https://www.cnil.fr/'), 'confidentialite/index.html : lien vers la CNIL absent');
  // 8. Message « trop long » traduit dans le formulaire anglais
  check(readDist('en/index.html').includes('data-msg-too-long="Your message'), 'en/index.html : message « trop long » anglais absent du formulaire');
}
