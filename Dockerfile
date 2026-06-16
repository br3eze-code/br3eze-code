# syntax=docker/dockerfile:1
# Multi-stage build for AgentOS production

# ============================================
# BUILDER STAGE - Install dependencies
# ============================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
# --ignore-scripts prevents postinstall/preuninstall from running in Docker
# --legacy-peer-deps handles zod/openai peer dep resolution
RUN npm ci --omit=dev --ignore-scripts --legacy-peer-deps && \
    npm cache clean --force

# ============================================
# PRODUCTION STAGE - Runtime image
# ============================================
FROM node:22-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init ca-certificates

# Create app directory
WORKDIR /app

# Create non-root user (uid 1001 matches hosting.yaml runAsUser)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Create required directories with proper ownership
RUN mkdir -p logs skills certs data tmp/sessions tmp/models && \
    chown -R nodejs:nodejs /app

# Copy dependencies from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy application code
COPY --chown=nodejs:nodejs . .

# Ensure correct ownership after all copies
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Start application with dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "bin/agentos.js", "gateway"]
