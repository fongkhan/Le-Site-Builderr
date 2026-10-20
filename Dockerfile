# syntax=docker/dockerfile:1
# Image de production du serveur Meta-Builder : API, admin Payload, interface de
# l'orchestrateur et builds Astro des sites (README, « Déployer le serveur en production »).
#   docker build -t meta-builder .
#   docker compose --profile prod up -d      (base + serveur, voir docker-compose.yml)

# ---- Construction : dépendances (lockfiles d'abord, couche réutilisée) puis builds ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY server/package.json server/package-lock.json server/
COPY orchestrator/package.json orchestrator/package-lock.json orchestrator/
COPY client-template/package.json client-template/package-lock.json client-template/
# devDependencies comprises : TypeScript (build Next), Vite (orchestrateur)
RUN npm ci --prefix server --no-audit --no-fund \
 && npm ci --prefix orchestrator --no-audit --no-fund \
 && npm ci --prefix client-template --no-audit --no-fund
COPY . .
# Dossiers d'exécution présents dans l'image : un volume nommé monté dessus hérite de
# leur propriétaire (node)
RUN mkdir -p server/data server/uploads simulated_public_html drafts releases backups repositories
RUN npm run build --prefix orchestrator
# Build Next : la configuration Payload exige ces variables, sans aucune connexion
RUN DATABASE_URI=postgres://construction@127.0.0.1:5432/aucune \
    PAYLOAD_SECRET=construction-image-sans-secret \
    NEXT_TELEMETRY_DISABLED=1 \
    npm run build --prefix server

# ---- Exécution ----
FROM node:22-bookworm-slim
COPY --from=build --chown=node:node /app /app
USER node
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/server
EXPOSE 4000
# Disponibilité (base comprise) : /api/health/ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Node lancé directement (sans npm ni CLI tsx, qui tuerait le serveur occupé) : SIGTERM
# parvient au serveur lui-même (arrêt propre)
CMD ["node", "--import", "tsx", "index.js", "--production"]
