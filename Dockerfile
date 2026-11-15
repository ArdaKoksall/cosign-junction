FROM node:24-bookworm-slim AS server-build
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY adapters/package*.json adapters/
RUN npm --prefix adapters ci
COPY adapters/src adapters/src
COPY adapters/tsconfig*.json adapters/
RUN npm --prefix adapters run build
COPY server/package*.json server/
RUN npm --prefix server ci
COPY server/prisma server/prisma
COPY server/prisma.config.ts server/
COPY server/tsconfig*.json server/
COPY server/src server/src
WORKDIR /app/server
RUN npm run build

FROM server-build AS migrate
CMD ["npm", "run", "db:migrate"]

FROM server-build AS server-dependencies
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS api
WORKDIR /app/server
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=server-dependencies /app/server/node_modules node_modules
COPY --from=server-build /app/server/package.json package.json
COPY --from=server-build /app/server/dist dist
COPY --from=server-build /app/adapters/package.json /app/adapters/package.json
COPY --from=server-build /app/adapters/dist /app/adapters/dist
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]

FROM node:24-bookworm-slim AS web-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
ENV VITE_API_BASE=""
RUN npm run build

FROM nginx:1.30-alpine AS web
COPY --from=web-build /app/client/dist /usr/share/nginx/html
COPY docker/web.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 8080
