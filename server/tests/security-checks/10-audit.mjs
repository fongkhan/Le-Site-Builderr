// Journal d'audit : pagination et filtres validés, entrées non modifiables par l'API,
// GraphQL désactivé, modifications de comptes tracées. Aucun échec de connexion ici.
export default async function ({ BASE, ORIGIN, req, check, admin }) {
  if (!admin?.token) {
    check('Audit (module) : jeton admin disponible', false, 'login admin en échec');
    return;
  }
  const token = admin.token;
  const audit = (params) => req(`/api/audit?${new URLSearchParams(params)}`, { token });
  const docsOf = (r) => (Array.isArray(r.json) ? r.json : r.json?.docs || []);
  // Entrée correspondante, attendue au plus 3 s (écritures non attendues côté serveur)
  const waitAudit = async (params, predicate, since) => {
    const deadline = Date.now() + 3000;
    for (;;) {
      const hit = docsOf(await audit({ limit: '50', ...params })).find((d) => Date.parse(d.createdAt) >= since && predicate(d));
      if (hit || Date.now() > deadline) return hit || null;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };

  // ---- Pagination et validation des paramètres ----
  {
    const second = await audit({ limit: '1', page: '2' });
    check('Audit : ?limit=1&page=2 -> 1 entrée, page 2', second.status === 200 && docsOf(second).length === 1 && second.json?.page === 2, `HTTP ${second.status} page=${second.json?.page} ${docsOf(second).length} entrée(s)`);
    check('Audit : ?limit=0 -> 400', (await audit({ limit: '0' })).status === 400);
    check('Audit : ?limit=201 -> 400', (await audit({ limit: '201' })).status === 400);
    check('Audit : ?action=%25 -> 400', (await req('/api/audit?action=%25', { token })).status === 400);
  }

  // ---- Immutabilité : ni suppression, ni modification, ni création par l'API REST ----
  {
    const first = docsOf(await audit({ limit: '1' }))[0];
    if (first?.id !== undefined) {
      const del = await req(`/api/audit_logs/${first.id}`, { method: 'DELETE', token });
      check('Audit : admin DELETE /api/audit_logs/<id> -> 403', del.status === 403, `HTTP ${del.status}`);
      const patch = await req(`/api/audit_logs/${first.id}`, { method: 'PATCH', body: { details: 'falsifié' }, token });
      check('Audit : admin PATCH /api/audit_logs/<id> -> 403', patch.status === 403, `HTTP ${patch.status}`);
      const post = await req('/api/audit_logs', { method: 'POST', body: { action: 'faux.evenement', actor: 'x' }, token });
      check('Audit : admin POST /api/audit_logs -> 403', post.status === 403, `HTTP ${post.status}`);
      const still = docsOf(await audit({ limit: '200' })).find((d) => String(d.id) === String(first.id));
      check('Audit : entrée toujours présente', Boolean(still) && still.details === first.details, JSON.stringify(still?.details));
    } else {
      check('Audit : au moins une entrée à protéger', false);
    }
  }

  // ---- GraphQL désactivé : aucune seconde porte d'entrée ----
  {
    const gql = await req('/api/graphql', { method: 'POST', body: { query: '{ __typename }' } });
    check('GraphQL : POST /api/graphql -> 404', gql.status === 404, `HTTP ${gql.status}`);
    const playground = await req('/api/graphql-playground');
    check('GraphQL : GET /api/graphql-playground -> 404', playground.status === 404, `HTTP ${playground.status}`);
  }

  // ---- Audit des comptes : offre, quota, sites, suppression ----
  {
    const email = 'audit-compte@nulle-part.example';
    const purge = async () => {
      const existing = await req(`/api/users?where[email][equals]=${encodeURIComponent(email)}`, { token });
      const id = existing.json?.docs?.[0]?.id;
      if (id) await req(`/api/users/${id}`, { method: 'DELETE', token });
    };
    await purge();
    const since = Date.now() - 2000;
    const created = await req('/api/users', { method: 'POST', body: { email, password: 'Cheval-Correct-42!', roles: ['client'] }, token });
    const id = created.json?.doc?.id;
    check('Audit des comptes : compte jetable créé', Boolean(id), `HTTP ${created.status}`);
    if (id) {
      const creation = await waitAudit({ action: 'utilisateur.creation', target: email }, () => true, since);
      check('Audit des comptes : création tracée', Boolean(creation) && creation.actor === 'admin@admin.com' && (creation.details || '').includes('roles=client'), JSON.stringify(creation?.details));

      await req(`/api/users/${id}`, { method: 'PATCH', body: { plan: 'pro', aiDailyQuota: 5 }, token });
      const planChange = await waitAudit({ action: 'utilisateur.modification', target: email }, (d) => (d.details || '').includes('plan=free→pro'), since);
      check('Audit des comptes : offre et quota tracés', Boolean(planChange) && planChange.details.includes('aiDailyQuota=∅→5') && planChange.actor === 'admin@admin.com', JSON.stringify(planChange?.details));

      const site = await req('/api/payload_sites?where[slug][equals]=boulangerie-artisanale&limit=1&depth=0', { token });
      const siteId = site.json?.docs?.[0]?.id;
      if (siteId !== undefined) {
        await req(`/api/users/${id}`, { method: 'PATCH', body: { sites: [siteId] }, token });
        const siteChange = await waitAudit({ action: 'utilisateur.modification', target: email }, (d) => (d.details || '').includes('sites=+[boulangerie-artisanale]'), since);
        check('Audit des comptes : rattachement de site tracé (slug)', Boolean(siteChange), JSON.stringify(siteChange?.details));
      } else {
        check('Audit des comptes : site de démonstration trouvé', false);
      }

      // Hooks d'audit exécutés dans la transaction de chaque écriture : 12 modifications
      // simultanées (plus que les 10 connexions du pool) ne doivent jamais bloquer le pool
      const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => fetch(`${BASE}/api/users/${id}`, {
        method: 'PATCH',
        headers: { Origin: ORIGIN, Cookie: `payload-token=${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiDailyQuota: 10 + i }),
        signal: AbortSignal.timeout(20000),
      }).then((r) => r.status).catch(() => 'délai dépassé')));
      check('Audit : 12 modifications simultanées d’un compte -> toutes traitées (pool jamais bloqué)', burst.every((s) => s === 200), burst.join(','));

      await req(`/api/users/${id}`, { method: 'DELETE', token });
      const deletion = await waitAudit({ action: 'utilisateur.suppression', target: email }, () => true, since);
      check('Audit des comptes : suppression tracée', Boolean(deletion) && deletion.actor === 'admin@admin.com', JSON.stringify(deletion?.details));

      // Aucun secret dans les entrées du compte
      const all = JSON.stringify(docsOf(await audit({ limit: '200', target: email })));
      check('Audit des comptes : aucun mot de passe ni hash dans le journal', !all.includes('Cheval-Correct-42!') && !/"(hash|salt)"|resetPasswordToken/.test(all));
    }
    await purge();
  }
}
