# Node 20 reached end of life in April 2026. Node 22 is the current LTS and
# satisfies the ">=20" engines constraint in package.json.
#
# The previous image ran `npm install -g npm@latest` to pick up patched bundled
# dependencies. That was unpinned, so the image broke on its own the day npm 12
# shipped: npm 12 requires Node >=22 and refused to install on Node 20. The
# npm bundled with Node 22 is current, so the global upgrade is gone — Trivy in
# security.yml is what verifies the image is clean, not a hand-rolled upgrade.
FROM node:22-alpine AS deps
WORKDIR /app
# Pull patched alpine packages (openssl, etc.) on top of the base image.
RUN apk -U upgrade --no-cache
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine
WORKDIR /app
# Pull patched alpine packages on top of the base image.
RUN apk -U upgrade --no-cache

COPY --from=deps /app/node_modules ./node_modules
COPY server.js ./
COPY lib/ ./lib/
COPY public/ ./public/

# node:22-alpine ships with a non-root 'node' user at UID/GID 1000.
# Reuse it rather than creating a duplicate group.
RUN chown -R node:node /app

USER node

ENV NODE_ENV=production \
    PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/healthz || exit 1

CMD ["node", "server.js"]
