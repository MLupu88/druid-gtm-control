FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig*.json ./
COPY artifacts ./artifacts
COPY lib ./lib
COPY scripts ./scripts

RUN pnpm config set dangerouslyAllowAllBuilds true
RUN pnpm install --frozen-lockfile
RUN PORT=5000 BASE_PATH=/ pnpm --filter @workspace/api-server --filter @workspace/druid-gtm run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY artifacts/api-server/package.json ./artifacts/api-server/package.json
COPY lib ./lib
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /app/artifacts/druid-gtm/dist ./artifacts/druid-gtm/dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules

EXPOSE 5000

CMD ["pnpm", "--filter", "@workspace/api-server", "run", "start"]
