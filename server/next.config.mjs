import path from 'path'
import { fileURLToPath } from 'url'
import { withPayload } from '@payloadcms/next/withPayload'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Optimiseur d'images de Next (/_next/image) désactivé : surface d'attaque (RCE de
  // l'optimiseur AVIF, SSRF) sans usage ici — l'admin Payload n'utilise pas next/image.
  // Express répond de toute façon 404 sur /_next/image (express-app.js).
  images: { unoptimized: true },
  // Racine du traçage des fichiers : le dossier server/ (le dépôt contient d'autres
  // package-lock.json, qui tromperaient la détection automatique de Next).
  outputFileTracingRoot: dirname,
}

export default withPayload(nextConfig)
