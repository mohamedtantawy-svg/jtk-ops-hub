FROM public.ecr.aws/docker/library/node:22-alpine AS builder
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm ci && npm run build && mkdir -p public

FROM public.ecr.aws/docker/library/node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cap V8 heap to 768 MB — leaves ~256 MB for native allocations, buffers,
# and OS overhead inside the 1–2 GB container memory limit. Without this,
# Node 22 will try to auto-size the heap close to the cgroup limit and
# risk an OOM kill before GC can reclaim.
ENV NODE_OPTIONS="--max-old-space-size=768"
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
RUN npm install --no-save pg pg-hstore
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
