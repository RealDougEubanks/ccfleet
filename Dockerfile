FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:20-alpine
WORKDIR /app

ARG APP_UID=1000
RUN addgroup -g ${APP_UID} ccfleet && adduser -u ${APP_UID} -G ccfleet -S ccfleet

COPY --from=deps /app/node_modules ./node_modules
COPY server.js ./
COPY lib/ ./lib/
COPY public/ ./public/

RUN chown -R ccfleet:ccfleet /app

USER ccfleet

ENV NODE_ENV=production \
    PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/healthz || exit 1

CMD ["node", "server.js"]
