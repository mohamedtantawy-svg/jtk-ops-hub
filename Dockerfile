FROM public.ecr.aws/docker/library/node:22-alpine AS builder
ARG CODEARTIFACT_AUTH_TOKEN
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm ci && npm run build && mkdir -p public

FROM public.ecr.aws/docker/library/node:22-alpine AS runner
ARG CODEARTIFACT_AUTH_TOKEN
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cap V8's old space well below the 4 GiB cgroup limit. Node sizes the
# default heap off the HOST's RAM (it can't see the container limit), so
# in production the heap lazily ballooned to 1.3+ GiB of uncollected
# garbage between major GCs and pod RSS floated at 1.5-2 GiB on a
# ~450 MiB live set (2026-06-10 log audit). With the cap, full GCs run
# once the old space nears 896 MiB, keeping steady-state RSS under
# ~1 GiB. If the pod ever crashes with "JavaScript heap out of memory",
# raise this to 1024 before anything else.
ENV NODE_OPTIONS="--max-old-space-size=896"
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.npmrc* ./
RUN npm install --no-save pg pg-hstore
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
