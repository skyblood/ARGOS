# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Copy manifests first for layer cache
COPY package*.json tsconfig.json ./
COPY packages/argos-core/package*.json ./packages/argos-core/
COPY packages/argos-cli/package*.json  ./packages/argos-cli/

RUN npm ci --workspace=packages/argos-core \
           --workspace=packages/argos-cli \
           --ignore-scripts

COPY packages/argos-core ./packages/argos-core
COPY packages/argos-cli  ./packages/argos-cli

RUN npm run build -w packages/argos-core \
  && npm run build -w packages/argos-cli

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
# Non-root user, read-only filesystem, /output volume only writable path
FROM node:22-alpine AS runtime

RUN addgroup -S argos && adduser -S argos -G argos

WORKDIR /app

# package.json files required by Node.js ESM for "type": "module" resolution
COPY --from=builder /app/package.json                          ./package.json
COPY --from=builder /app/packages/argos-core/package.json     ./packages/argos-core/package.json
COPY --from=builder /app/packages/argos-cli/package.json      ./packages/argos-cli/package.json

# Compiled output
COPY --from=builder /app/packages/argos-core/dist  ./packages/argos-core/dist
COPY --from=builder /app/packages/argos-cli/dist   ./packages/argos-cli/dist

# Production node_modules only (commander + workspace symlinks)
COPY --from=builder /app/node_modules ./node_modules

# Writable output volume — owned by argos
RUN mkdir -p /output && chown argos:argos /output

USER argos

# Read-only filesystem enforced at runtime (docker run --read-only)
# /output and /tmp remain writable via tmpfs mounts
VOLUME ["/output"]

HEALTHCHECK --interval=30s --timeout=5s --retries=1 \
  CMD node packages/argos-cli/dist/index.js --version || exit 1

ENTRYPOINT ["node", "packages/argos-cli/dist/index.js"]
CMD ["--help"]
