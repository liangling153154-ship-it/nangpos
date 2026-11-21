FROM node:22-slim AS builder
WORKDIR /app

COPY package.json ./
COPY shared ./shared
COPY server/package.json server/package-lock.json* ./server/
COPY client/package.json client/package-lock.json* ./client/

RUN npm ci --prefix server && npm ci --prefix client

COPY server ./server
COPY client ./client

RUN npm run build:client && npm run build:server

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY server/package.json server/package-lock.json* ./server/
RUN npm ci --omit=dev --prefix server

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 3000
CMD ["npm", "run", "start"]
