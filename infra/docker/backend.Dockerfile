FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# ---- Build the frontend (produces /app/frontend/.next) ----
FROM base AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/tsconfig.json frontend/next.config.mjs frontend/next-env.d.ts ./
COPY frontend/src ./src
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

# ---- Build the backend (produces /app/backend/dist) ----
FROM base AS backend-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npx tsc -p tsconfig.json

# ---- Runtime: both node_modules trees + built artifacts ----
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=9009
ENV CORTEX_ENV=production

WORKDIR /app/frontend
COPY --from=frontend-build /app/frontend/.next          ./.next
COPY --from=frontend-build /app/frontend/node_modules   ./node_modules
COPY --from=frontend-build /app/frontend/package.json   ./
COPY --from=frontend-build /app/frontend/next.config.mjs ./
# Next.js custom server still calls findPagesDir() at runtime, which checks
# the filesystem for app/ or pages/. Without these the app crashes on boot
# with "Couldn't find any `pages` or `app` directory".
COPY --from=frontend-build /app/frontend/src            ./src
COPY --from=frontend-build /app/frontend/tsconfig.json  ./
COPY --from=frontend-build /app/frontend/next-env.d.ts  ./

WORKDIR /app/backend
COPY --from=backend-build /app/backend/node_modules ./node_modules
COPY --from=backend-build /app/backend/dist         ./dist
COPY --from=backend-build /app/backend/package.json ./

EXPOSE 9009
CMD ["node", "dist/server.js"]
