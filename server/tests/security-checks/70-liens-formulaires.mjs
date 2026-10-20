// Liens des boutons (ctaLink) et en-têtes des fichiers servis (lot 7).
// - CMS (/api/site-pages) et REST Payload (/api/pages) refusent les liens exécutables,
//   mais acceptent une saisie partielle (sauvegarde automatique) ;
// - aller-retour des liens (bannière, formule, produit) sans réécriture inutile ;
// - pages HTML de /preview et /draft servies avec une CSP (pas de plugin, pas de cadre
//   étranger), sans bac à sable (réservé aux SVG/XML).
// Aucun échec de connexion, aucun POST /api/contact ; tout ce qui est créé est supprimé.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export default async function ({ BASE, ORIGIN, req, check, admin, client }) {
  const payloadSiteId = async (slug) => (await req(`/api/payload_sites?where[slug][equals]=${slug}&depth=0`, { token: admin.token })).json?.docs?.[0]?.id;

  // ---- CMS : validation à l'enregistrement, puis aller-retour ----
  if (admin.token) {
    const created = await req('/api/sites', { method: 'POST', body: { name: 'Liens SC' }, token: admin.token });
    const slug = created.json?.site?.slug;
    check('Liens : site temporaire créé', Boolean(slug), `HTTP ${created.status}`);
    if (slug) {
      try {
        const url = `/api/site-pages?site=${slug}`;
        const save = (layout) => req(url, { method: 'POST', body: { docs: [{ title: 'Accueil', slug: 'home', layout }] }, token: admin.token });
        const hero = (ctaLink) => ({ blockType: 'hero', title: 'Bienvenue', ctaText: 'Réserver', ctaLink });
        const plan = (ctaLink) => ({ name: 'Base', price: '10 €', description: '', features: [], ctaText: 'Réserver', ctaLink, isPopular: false });
        const product = (ctaLink) => ({ name: 'Bol', price: '20 €', image: '', ctaLink });

        const badHero = await save([hero('javascript:alert(1)')]);
        check('Liens : bannière ctaLink javascript: -> 400', badHero.status === 400, `HTTP ${badHero.status}`);
        const badPlan = await save([{ blockType: 'pricing', title: 'Tarifs', plans: [plan(' JaVa\tScRiPt:alert(1)')] }]);
        check('Liens : formule ctaLink « JaVa<tab>ScRiPt: » -> 400', badPlan.status === 400, `HTTP ${badPlan.status}`);
        const badProduct = await save([{ blockType: 'product-grid', title: 'Boutique', products: [product('data:text/html,<script>alert(1)</script>')] }]);
        check('Liens : produit ctaLink data:text/html -> 400', badProduct.status === 400, `HTTP ${badProduct.status}`);
        const partial = await save([hero('https:/')]);
        check('Liens : saisie en cours (« https:/ ») non bloquée -> 200', partial.status === 200, `HTTP ${partial.status}`);

        const layout = [
          hero('/tarifs/'),
          { blockType: 'pricing', title: 'Tarifs', plans: [plan('https://exemple.fr/reserver')] },
          { blockType: 'product-grid', title: 'Boutique', products: [product('tel:+33478000000')] },
        ];
        const docs = [{ title: 'Accueil', slug: 'home', layout }, { title: 'Tarifs', slug: 'tarifs', layout: [] }];
        const wrote = await req(url, { method: 'POST', body: { docs }, token: admin.token });
        const read = await req(url, { token: admin.token });
        const home = read.json?.docs?.find((p) => p.slug === 'home');
        const links = [home?.layout?.[0]?.ctaLink, home?.layout?.[1]?.plans?.[0]?.ctaLink, home?.layout?.[2]?.products?.[0]?.ctaLink];
        const expected = ['/tarifs/', 'https://exemple.fr/reserver', 'tel:+33478000000'];
        check('Liens : bannière, formule et produit relus dans l’ordre', wrote.status === 200 && JSON.stringify(links) === JSON.stringify(expected), `HTTP ${wrote.status} ${JSON.stringify(links)}`);

        const siteId = await payloadSiteId(slug);
        if (siteId && Array.isArray(read.json?.docs)) {
          const stamps = async () => ((await req(`/api/pages?where[site][equals]=${siteId}&depth=0&limit=50&sort=slug`, { token: admin.token })).json?.docs || []).map((p) => `${p.slug}@${p.updatedAt}`).join(',');
          const before = await stamps();
          const resave = await req(url, { method: 'POST', body: { docs: read.json.docs }, token: admin.token });
          const after = await stamps();
          check("Liens : renvoyer le contenu lu n'écrit aucune page", resave.status === 200 && before !== '' && before === after, `${before} → ${after}`);
        } else {
          check('Liens : site temporaire retrouvé dans Payload', false, `siteId=${siteId}`);
        }
      } finally {
        await req(`/api/sites/${slug}?deleteFiles=true`, { method: 'DELETE', token: admin.token });
      }
    }
  }

  // ---- REST Payload : le client ne contourne pas la validation du CMS ----
  if (admin.token && client.token) {
    const ownId = await payloadSiteId('boulangerie-artisanale');
    if (ownId) {
      const heroLayout = (ctaLink) => [{ blockType: 'hero', title: 'x', ctaLink }];
      const rejected = await req('/api/pages', { method: 'POST', body: { title: 'SC liens refusé', slug: 'sc-liens-refuse', site: ownId, layout: heroLayout('javascript:alert(1)') }, token: client.token });
      check('REST Payload : client crée une page avec ctaLink javascript: -> 400', rejected.status === 400, `HTTP ${rejected.status}`);
      if (rejected.json?.doc?.id) await req(`/api/pages/${rejected.json.doc.id}`, { method: 'DELETE', token: admin.token });

      const page = await req('/api/pages', { method: 'POST', body: { title: 'SC liens', slug: 'sc-liens', site: ownId, layout: [] }, token: client.token });
      const pageId = page.json?.doc?.id;
      check('REST Payload : client crée une page jetable sur SON site -> 201', Boolean(pageId), `HTTP ${page.status}`);
      if (pageId) {
        try {
          const bad = await req(`/api/pages/${pageId}`, { method: 'PATCH', body: { layout: heroLayout('javascript:alert(1)') }, token: client.token });
          check('REST Payload : client PATCH ctaLink javascript: -> 400', bad.status === 400, `HTTP ${bad.status}`);
          // Validation par défaut du type text conservée (longueur maximale de Payload)
          const long = await req(`/api/pages/${pageId}`, { method: 'PATCH', body: { layout: heroLayout(`https://exemple.fr/${'a'.repeat(40000)}`) }, token: client.token });
          check('REST Payload : client PATCH ctaLink de plus de 40 000 caractères -> 400', long.status === 400, `HTTP ${long.status}`);
          const ok = await req(`/api/pages/${pageId}`, { method: 'PATCH', body: { layout: heroLayout('/contact/') }, token: client.token });
          check('REST Payload : client PATCH ctaLink « /contact/ » -> 200', ok.status === 200, `HTTP ${ok.status}`);
          const after = await req(`/api/pages/${pageId}?depth=0`, { token: admin.token });
          check('REST Payload : ctaLink enregistré tel quel, jamais le lien refusé', after.json?.layout?.[0]?.ctaLink === '/contact/', JSON.stringify(after.json?.layout?.[0]?.ctaLink));
        } finally {
          await req(`/api/pages/${pageId}`, { method: 'DELETE', token: admin.token });
        }
      }
    } else {
      check('REST Payload : site de démonstration retrouvé', false);
    }
  }

  // ---- En-têtes des pages HTML servies (/preview, /draft) ----
  const htmlCsp = (r) => {
    const csp = r.headers.get('content-security-policy') || '';
    return { csp, ok: r.status === 200 && csp.includes("frame-ancestors 'self'") && csp.includes("object-src 'none'") && !csp.includes('sandbox') };
  };
  const withTempHtml = async (dir, run) => {
    const createdDir = !fs.existsSync(dir);
    const file = path.join(dir, 'csp-test.html');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, '<!doctype html><title>CSP</title>');
    try {
      await run();
    } finally {
      fs.rmSync(file, { force: true });
      if (createdDir) fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  await withTempHtml(path.join(projectDir, 'simulated_public_html', 'boulangerie-artisanale'), async () => {
    const r = await fetch(`${BASE}/preview/boulangerie-artisanale/csp-test.html`, { headers: { Origin: ORIGIN } });
    const { csp, ok } = htmlCsp(r);
    check("Aperçu : page HTML servie avec CSP (frame-ancestors 'self', object-src 'none', sans sandbox)", ok, `HTTP ${r.status} ${csp}`);
  });
  if (client.token) {
    await withTempHtml(path.join(projectDir, 'drafts', 'boulangerie-artisanale'), async () => {
      const r = await fetch(`${BASE}/draft/boulangerie-artisanale/csp-test.html`, { headers: { Origin: ORIGIN, Cookie: `payload-token=${client.token}` } });
      const { csp, ok } = htmlCsp(r);
      check("Brouillon : page HTML servie avec CSP (frame-ancestors 'self', object-src 'none', sans sandbox)", ok, `HTTP ${r.status} ${csp}`);
    });
  }
}
