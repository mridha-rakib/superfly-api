FROM node:20-alpine AS deps

WORKDIR /app

ARG BUILD_NODE_OPTIONS=--max-old-space-size=512

ENV NODE_OPTIONS=${BUILD_NODE_OPTIONS} \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    npm_config_loglevel=warn

COPY package*.json ./
RUN npm ci

FROM deps AS builder

COPY . .
RUN npm run build && npm prune --omit=dev


FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/assets ./src/assets
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/tsconfig-paths-bootstrap.js ./tsconfig-paths-bootstrap.js

EXPOSE 3000

CMD ["node", "-r", "./tsconfig-paths-bootstrap.js", "dist/index.js"]
