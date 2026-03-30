# ── Stage 1: Build frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS fe-build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: Build backend ──────────────────────────────────────────────────
FROM node:20-alpine AS be-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci
COPY backend/ .
RUN npm run build

# ── Stage 3: Production image ───────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Install only production deps for backend
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled backend
COPY --from=be-build /app/backend/dist ./dist

# Copy migration SQL files (needed at runtime)
COPY backend/src/infrastructure/persistence/migrations ./dist/infrastructure/persistence/migrations

# Copy frontend build output → public/ (served by Express in production)
COPY --from=fe-build /app/dist ./public

# Non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup
USER appuser

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Health check for EKS
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "dist/infrastructure/http/server.js"]
