FROM node:24-alpine
# сервер работает не от root: su-exec отдаёт /data пользователю node и запускает сервер от него
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.mjs merge.mjs mail.mjs pages.mjs telegram.mjs stripe.mjs ./
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 NODE_NO_WARNINGS=1
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
# /data создан на сервере от root (и файлы, восстановленные из копии) — отдаём пользователю node только то, что не его
CMD ["sh", "-c", "find /data ! -user node -exec chown node:node {} + ; exec su-exec node node server.mjs"]
