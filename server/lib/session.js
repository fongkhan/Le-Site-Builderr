// Options du cookie de session Payload (payload-token). Secure par défaut en production ;
// COOKIE_SECURE=true|false force la valeur (ex. recette servie en HTTP simple).
function authCookieOptions(env = process.env) {
  const raw = env.COOKIE_SECURE;
  const secure = raw !== undefined && raw !== '' ? raw === 'true' : env.NODE_ENV === 'production';
  return { sameSite: 'Lax', secure };
}

module.exports = { authCookieOptions };
