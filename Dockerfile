FROM public.ecr.aws/docker/library/node:22-alpine AS builder
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm ci && npm run build && mkdir -p public

FROM public.ecr.aws/docker/library/node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
RUN npm install --no-save pg pg-hstore
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# APP_VERSION is baked at build time by the CI (see .github/workflows/ci.yml,
# build-args: BUILD_SHA=${{ github.sha }}). The /api/v1/version endpoint reads
# this so the client can detect when the server has rolled to a new deploy and
# prompt the user to reload (see src/hooks/useVersionCheck.js). We do it here
# rather than in the Helm chart because Nexus's platform periodically syncs
# helm/templates/ back to its base template and would wipe a custom env block.
ARG BUILD_SHA=unknown
ENV APP_VERSION=$BUILD_SHA
CMD ["node", "server.js"]
