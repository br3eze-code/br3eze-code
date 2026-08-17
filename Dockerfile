# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build
WORKDIR /app

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build:product-query

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOME=/tmp \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

RUN groupadd --system --gid 10001 agentos \
 && useradd --system --uid 10001 --gid 10001 --home-dir /app --shell /usr/sbin/nologin agentos \
 && mkdir -p /app/data /app/logs /app/state /app/dist \
 && chown -R agentos:agentos /app

COPY --from=build --chown=agentos:agentos /app/package.json /app/package-lock.json ./
COPY --from=build --chown=agentos:agentos /app/node_modules ./node_modules
COPY --from=build --chown=agentos:agentos /app/bin ./bin
COPY --from=build --chown=agentos:agentos /app/src ./src
COPY --from=build --chown=agentos:agentos /app/config ./config
COPY --from=build --chown=agentos:agentos /app/scripts ./scripts
COPY --from=build --chown=agentos:agentos /app/www ./www
COPY --from=build --chown=agentos:agentos /app/main.js /app/agentos.mjs ./
COPY --from=build --chown=agentos:agentos /app/dist ./dist

USER agentos
EXPOSE 19876 9090

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.GATEWAY_PORT||19876)+'/health',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "bin/agentos.js", "gateway"]
