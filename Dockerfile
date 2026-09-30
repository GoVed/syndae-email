FROM node:20-alpine AS base
RUN apk add --no-cache dumb-init ca-certificates
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY bin/ ./bin/
COPY instructions.md ./instructions.md
COPY manifest.json ./manifest.json

ENV NODE_ENV=production \
    HTTP_PORT=8771 \
    HTTP_HOST=0.0.0.0 \
    LOG_LEVEL=info

EXPOSE 8771

HEALTHCHECK --interval=20s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8771/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js", "daemon"]
