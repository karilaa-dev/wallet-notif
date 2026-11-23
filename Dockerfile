FROM node:24-bookworm-slim AS client
WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_PATH=/app/data/wallet.sqlite
COPY package*.json ./
RUN npm ci --omit=dev && install -d -m 0700 -o node -g node /app/data
COPY server/ ./server/
COPY --from=client /build/client/dist ./client/dist
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
