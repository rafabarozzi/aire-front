FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build:node

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 AIRE_MODE=live AIRE_DATA_DIR=/data
RUN groupadd --gid 1001 aire && useradd --uid 1001 --gid aire --no-create-home aire && mkdir /data && chown aire:aire /data
WORKDIR /app
COPY --from=build --chown=aire:aire /app/.next-node/standalone ./
COPY --from=build --chown=aire:aire /app/.next-node/static ./.next-node/static
COPY --from=build --chown=aire:aire /app/public ./public
COPY --chown=aire:aire scripts/seed-northeia-lab.mjs ./scripts/seed-northeia-lab.mjs
USER 1001:1001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
