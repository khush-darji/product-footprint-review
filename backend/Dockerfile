# Multi-stage: the runtime image carries compiled JS and production dependencies only,
# not the TypeScript toolchain.

# ---- deps: full install, cached on the lockfile alone -----------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# argon2 is a native module with no prebuilt binary for alpine/arm64, so it compiles
# from source and needs a toolchain. This stays in the deps stage only: the production
# stage copies the already-compiled node_modules, so the final image carries the .node
# binary without python3, make or g++.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile TypeScript ----------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- development: source mounted in, hot reload via tsx ---------------------------
FROM node:20-alpine AS development
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 4000
CMD ["npm", "run", "dev"]

# ---- production -------------------------------------------------------------------
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# tini reaps zombies and forwards signals; see ENTRYPOINT below.
RUN apk add --no-cache tini

# Prune dev dependencies rather than reinstalling: same resolved tree, no network.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
RUN npm prune --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Run as the unprivileged user the base image already provides. A container process
# running as root is a container escape away from a root host process.
USER node

EXPOSE 4000

# Forwards SIGTERM to node as PID 1 so the graceful shutdown in server.ts actually
# runs; without an init, signals are dropped and every deploy severs live requests.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
