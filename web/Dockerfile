# syntax=docker/dockerfile:1.7

# Junta deps + build no mesmo stage pra evitar o COPY --from=deps node_modules
# (que sozinho leva ~50s pelo volume de arquivos pequenos). O image final
# continua enxuto porque o stage `runner` só copia .next/standalone, .next/static
# e public — node_modules de build NÃO chega no runtime.

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./

# Cache mount no /root/.npm acelera npm ci em mudanças subsequentes de
# package.json. --prefer-offline força usar o cache, --no-audit pula o
# passo de audit que é puramente network-bound.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit

COPY . .

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

# Cache do Next.js (.next/cache) persiste entre builds — em rebuilds onde
# poucos arquivos mudaram, Turbopack reaproveita módulos pré-compilados.
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
