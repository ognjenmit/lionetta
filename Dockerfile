FROM node:24.19.0-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN --mount=type=secret,id=cloud_ca \
    if [ -f /run/secrets/cloud_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/cloud_ca; fi; \
    npm ci --no-audit --no-fund

FROM dependencies AS backend-build
COPY tsconfig.json ./
COPY apps/api ./apps/api
COPY packages ./packages
COPY mcp ./mcp
RUN npm run build:backend

FROM dependencies AS web-build
ENV NEXT_TELEMETRY_DISABLED=1
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared
RUN npm run build --workspace @lionetta/web

FROM node:24.19.0-bookworm-slim AS backend
ENV NODE_ENV=production HOST=0.0.0.0 API_PORT=8080
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=backend-build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node config ./config
COPY --chown=node:node fixtures ./fixtures
USER node
EXPOSE 8080
CMD ["node", "dist/apps/api/src/server.js"]

FROM node:24.19.0-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=web-build --chown=node:node /app/apps/web ./apps/web
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "apps/web", "--hostname", "0.0.0.0", "--port", "3000"]
