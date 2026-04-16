FROM public.ecr.aws/docker/library/node:22-alpine AS builder
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm ci && npm run build && mkdir -p public

FROM public.ecr.aws/docker/library/node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cap V8 heap to 3 GB — leaves ~1 GB for native allocations, buffers,
# and OS overhead inside the 4 GB container memory limit.
ENV NODE_OPTIONS="--max-old-space-size=3072"
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
RUN npm install --no-save pg pg-hstore
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
