ARG BUILD_FROM=node:22-alpine

# ---- build: web (Vite) + server (tsc), then a pruned production deploy of the server
FROM node:22-alpine AS build
RUN apk add --no-cache python3 make g++ && corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/frame-tv/package.json packages/frame-tv/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile
COPY packages packages
RUN pnpm --filter @frame-art/frame-tv build \
 && pnpm --filter @frame-art/server build \
 && pnpm --filter web build
RUN pnpm --filter @frame-art/server deploy --prod --legacy /out \
 && cp -r packages/web/dist /out/public \
 && rm -rf /out/src /out/test /out/scripts /out/vitest.config.ts

# ---- runtime: Node serves the API and the static files; nothing else
FROM ${BUILD_FROM}
RUN apk add --no-cache tini
ENV NODE_ENV=production FRAME_ART_DATA=/data PORT=8099
WORKDIR /app
COPY --from=build /out /app
EXPOSE 8099
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]

ARG BUILD_VERSION=dev
LABEL io.hass.type="addon" io.hass.arch="aarch64" io.hass.version="${BUILD_VERSION}" \
      org.opencontainers.image.source="https://github.com/dstollie/ha-frame-art"
