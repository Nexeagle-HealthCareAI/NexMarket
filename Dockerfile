# Next.js standalone build — see next.config.ts `output: 'standalone'`.
# Build context is the repo root (docker build -f Dockerfile .)

FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, so the
# API origin must be known here, not just at container runtime.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
# Optional — omit to use OpenFreeMap's free basemap (see
# src/lib/geo/mapStyle.ts).
ARG NEXT_PUBLIC_MAPBOX_TOKEN
ENV NEXT_PUBLIC_MAPBOX_TOKEN=${NEXT_PUBLIC_MAPBOX_TOKEN}
# Optional — web-push public key; omit and push notifications stay disabled.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Web-push subscription store (src/lib/push/store.ts). Mount a volume here so
# subscriptions survive redeploys; created up front so the volume inherits
# nextjs ownership.
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
ENV PUSH_DATA_DIR=/app/data

USER nextjs
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
