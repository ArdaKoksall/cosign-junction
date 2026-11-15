FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git openssl procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspaces/junction
RUN install -d -o node -g node adapters/node_modules server/node_modules client/node_modules

USER node
