// Limiteur du formulaire de contact (DERNIER module à toucher /api/contact : épuise le
// budget de 10 envois par fenêtre de 15 min, dont 7 consommés par la matrice) : 429 avec
// un code stable en JSON, puis page HTML traduite pour un envoi sans JavaScript.
// Envois invalides uniquement : aucun message enregistré.
export default async function ({ BASE, req, check }) {
  const url = '/api/contact/boulangerie-artisanale';
  let last = null;
  let sent = 0;
  for (let i = 0; i < 12; i++) {
    sent++;
    last = await req(url, { method: 'POST', body: {} });
    if (last.status === 429) break;
  }
  check(
    'Contact : limiteur -> 429 avec le code rate_limited',
    last?.status === 429 && last?.json?.code === 'rate_limited',
    `HTTP ${last?.status} après ${sent} envoi(s) ${JSON.stringify(last?.json)}`
  );

  const form = await fetch(`${BASE}${url}?lang=en`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'name=x&email=a%40b.fr&message=bonjour',
  });
  const html = await form.text();
  check(
    'Contact sans JavaScript : limiteur -> 429 en page HTML traduite (?lang=en)',
    form.status === 429 && (form.headers.get('content-type') || '').includes('text/html') && html.includes('<html lang="en">') && html.includes('Too many'),
    `HTTP ${form.status} ${html.slice(0, 120)}`
  );
}
