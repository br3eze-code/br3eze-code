# ── Stage 1: builder ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files from repo root (not server/)
COPY package*.json ./

# Install production deps only — npm 7+ syntax, skip lifecycle scripts
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ── Stage 2: production ───────────────────────────────────────────────────────
FROM node:22-alpine AS production

# dumb-init for proper PID 1 / signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser  -S nodejs -u 1001

# Copy production node_modules from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy application code — server.js lives in server/, source in src/
COPY --chown=nodejs:nodejs server/server.js ./server.js
COPY --chown=nodejs:nodejs src/ ./src/
COPY --chown=nodejs:nodejs bin/ ./bin/
COPY --chown=nodejs:nodejs scripts/ ./scripts/
COPY --chown=nodejs:nodejs package.json ./

# Create runtime directories as root before switching user
RUN mkdir -p logs skills && chown -R nodejs:nodejs logs skills

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',(r)=>r.statusCode===200?process.exit(0):process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
