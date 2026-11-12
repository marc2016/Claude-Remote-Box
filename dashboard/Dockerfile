# Status dashboard for claude-remote-box.
# Stage 1 builds the web app; the runtime stage holds the server, its production
# dependencies, and web/dist.
FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY shared ./shared
COPY web ./web
RUN npm run build

FROM node:26-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/marc2016/Claude-Remote-Box" \
      org.opencontainers.image.description="Status dashboard for claude-remote-box" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIR=/app/web/dist
WORKDIR /app
COPY package.json package-lock.json ./
# Production dependencies only: the WebAuthn library for the login.
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY shared ./shared
COPY server ./server
COPY --from=build /app/web/dist ./web/dist
# /data holds the SQLite file; writable for any UID the service runs as.
RUN mkdir -p /data && chmod 0777 /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --start-period=10s \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
