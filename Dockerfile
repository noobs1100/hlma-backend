# ---- Build stage ----
FROM oven/bun:1.3 AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

# Type-check (catches issues early)
RUN bunx tsc --noEmit

# ---- Dependencies stage (production only) ----
FROM oven/bun:1.3 AS deps

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production && \
    # Remove unused optional dependencies from better-auth
    rm -rf node_modules/@prisma \
           node_modules/prisma \
           node_modules/@better-auth/prisma-adapter \
           node_modules/@better-auth/mongo-adapter \
           node_modules/mongodb \
           node_modules/bson \
           node_modules/react \
           node_modules/react-dom \
           node_modules/@electric-sql \
           node_modules/effect \
           ~/.bun/install/cache

# ---- Production stage ----
FROM oven/bun:1.3-distroless

WORKDIR /app

# Copy production node_modules only
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy source files only
COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/tsconfig.json ./

EXPOSE 3000

CMD ["run", "src/index.ts"]
