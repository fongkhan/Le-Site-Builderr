import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { ORCHESTRATOR_CSP } from './src/lib/csp'

// CSP de l'orchestrateur compilé : <meta http-equiv> en tête de dist/index.html (build
// seulement : le serveur de dev de Vite injecte des scripts en ligne). frame-ancestors est
// ignoré dans une balise <meta> : le serveur Express le pose en en-tête quand il sert dist
// en production (server/express-app.js) ; un autre hébergeur de dist doit en faire autant.
function orchestratorCsp(): Plugin {
  return {
    name: 'orchestrator-csp',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: ORCHESTRATOR_CSP }, injectTo: 'head-prepend' }]
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), orchestratorCsp()],
  server: {
    // Toutes les requêtes API passent par le même origin que le front :
    // les cookies httpOnly de Payload circulent sans configuration SameSite particulière.
    proxy: {
      '/api': 'http://localhost:4000',
      '/webhook': 'http://localhost:4000',
      '/preview': 'http://localhost:4000',
      '/draft': 'http://localhost:4000',
      // Regex : /admin et /admin/** uniquement — PAS /admin-panel (route de la SPA)
      '^/admin(/|$)': { target: 'http://localhost:4000' },
      '/_next': 'http://localhost:4000',
    },
  },
})
