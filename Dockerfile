# syntax=docker/dockerfile:1.7
# One image definition for the backend; pick the process with --target:
#   docker build --target api    -t pool-api .
#   docker build --target worker -t pool-worker .
# Migrations run as a one-off container before rollout:
#   docker run --rm -e DATABASE_URL=... pool-api node dist/migrate.js

ARG NODE_VERSION=22

# Backend-only workspace manifests. The mobile/e2e workspaces are dropped so
# their packages (and optional peers such as drizzle's expo-sqlite) never reach
# the image; versions still come from the committed lockfile.
FROM node:${NODE_VERSION}-bookworm-slim AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/api-client/package.json packages/api-client/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/database/package.json packages/database/
COPY packages/sync/package.json packages/sync/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
COPY packages/validation/package.json packages/validation/
COPY services/api/package.json services/api/
COPY services/worker/package.json services/worker/
RUN node -e 'const f="package.json",p=require("./"+f);p.workspaces=["packages/*","services/*"];require("fs").writeFileSync(f,JSON.stringify(p,null,2))'

FROM manifests AS build
RUN npm install --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages packages
COPY services services
RUN npm run build -w @pool/api && npm run build -w @pool/worker

FROM manifests AS prod-deps
RUN npm install --omit=dev --no-audit --no-fund \
 && npm prune --omit=dev --omit=peer --no-audit --no-fund \
 && npm cache clean --force

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/migrations
WORKDIR /app
# Whole tree from prod-deps keeps any nested workspace node_modules; bundles
# live at their workspace paths so Node resolves dependencies exactly as in dev.
COPY --from=prod-deps --chown=node:node /app ./
COPY --chown=node:node packages/database/migrations ./migrations
# Writable location for STORAGE_DRIVER=local (named volumes inherit this owner).
RUN mkdir -p /data/storage && chown node:node /data/storage
USER node

FROM runtime AS worker
WORKDIR /app/services/worker
COPY --from=build --chown=node:node /app/services/worker/dist ./dist
CMD ["node", "--enable-source-maps", "dist/index.js"]

FROM runtime AS api
WORKDIR /app/services/api
COPY --from=build --chown=node:node /app/services/api/dist ./dist
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/server.js"]
