# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml* package-lock.json* ./

RUN corepack enable && pnpm install --frozen-lockfile 2>/dev/null || npm install

COPY tsconfig.json ./
COPY src ./src

RUN npx tsc

# ─── Stage 2: Run ────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tini

COPY package.json pnpm-lock.yaml* package-lock.json* ./

RUN corepack enable && pnpm install --omit=dev 2>/dev/null || npm install --omit=dev

RUN npm install tsconfig-paths

COPY --from=builder /app/dist ./dist
RUN echo '{"compilerOptions":{"baseUrl":".","paths":{"config/*":["./dist/config/*"],"shared/*":["./dist/shared/*"],"module/*":["./dist/module/*"],"errors/*":["./dist/errors/*"],"logger/*":["./dist/logger/*"],"redis/*":["./dist/redis/*"],"jwt/*":["./dist/jwt/*"],"mail/*":["./dist/mail/*"],"types/*":["./dist/types/*"],"Builder/*":["./dist/Builder/*"],"db/*":["./dist/db/*"],"config":["./dist/config"],"shared":["./dist/shared"],"module":["./dist/module"],"errors":["./dist/errors"],"logger":["./dist/logger"],"redis":["./dist/redis"],"jwt":["./dist/jwt"],"mail":["./dist/mail"],"types":["./dist/types"],"Builder":["./dist/Builder"],"db":["./dist/db"]}}}' > tsconfig.json

ENV NODE_ENV=production

EXPOSE 5003

RUN mkdir -p /app/logs && chown node:node /app/logs

USER node

ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "-r", "tsconfig-paths/register", "dist/server.js"]
