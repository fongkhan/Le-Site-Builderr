import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Toutes les requêtes API passent par le même origin que le front :
    // les cookies httpOnly de Payload circulent sans configuration SameSite particulière.
    proxy: {
      '/api': 'http://localhost:4000',
      '/webhook': 'http://localhost:4000',
      '/preview': 'http://localhost:4000',
      // Regex : /admin et /admin/** uniquement — PAS /admin-panel (route de la SPA)
      '^/admin(/|$)': { target: 'http://localhost:4000' },
      '/_next': 'http://localhost:4000',
    },
  },
})
