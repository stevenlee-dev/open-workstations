FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4312 HOST=0.0.0.0 DATA_DIR=/app/.data
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/.data && chown -R node:node /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/config ./config
USER node
EXPOSE 4312
CMD ["node", "server/index.mjs"]
