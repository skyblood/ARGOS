# Stage 1: build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/argos-core/package*.json ./packages/argos-core/
COPY packages/argos-cli/package*.json  ./packages/argos-cli/
RUN npm ci --workspace=packages/argos-core \
           --workspace=packages/argos-cli
COPY packages/argos-core ./packages/argos-core
COPY packages/argos-cli  ./packages/argos-cli
RUN npm run build -w packages/argos-core \
                  -w packages/argos-cli

# Stage 2: runtime — sin devDeps, sin código fuente
FROM node:22-alpine AS runtime
RUN addgroup -S argos && adduser -S argos -G argos
WORKDIR /app
COPY --from=builder /app/packages/argos-core/dist ./packages/argos-core/dist
COPY --from=builder /app/packages/argos-cli/dist  ./packages/argos-cli/dist
COPY --from=builder /app/node_modules             ./node_modules
RUN mkdir -p /output && chown argos:argos /output
USER argos
VOLUME ["/output"]
ENTRYPOINT ["node", "packages/argos-cli/dist/index.js"]
CMD ["--help"]
