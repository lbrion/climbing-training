FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
ENV DB_PATH=/data/climb.db
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
