FROM node:20-alpine AS deps
WORKDIR /app
# Update npm to get patched bundled deps (cross-spawn, minimatch, tar)
RUN npm install -g npm@latest --ignore-scripts
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:20-alpine
WORKDIR /app
# Update npm for the same reason — its bundled deps have known CVEs in older versions
RUN npm install -g npm@latest --ignore-scripts

COPY --from=deps /app/node_modules ./node_modules
COPY server.js ./
COPY lib/ ./lib/
COPY public/ ./public/

# node:20-alpine ships with a non-root 'node' user at UID/GID 1000.
# Reuse it rather than creating a duplicate group.
RUN chown -R node:node /app

USER node

ENV NODE_ENV=production \
    PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/healthz || exit 1

CMD ["node", "server.js"]
