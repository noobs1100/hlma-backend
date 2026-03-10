import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import Fastify, { type FastifyInstance } from "fastify";
import { db } from "../src/db";
import { books, bookCopies, racks, borrows, user, qrLabels } from "../src/db/schema";
import { bookRoutes } from "../src/routes/books";
import { copyRoutes } from "../src/routes/copies";
import { borrowRoutes } from "../src/routes/borrows";
import { rackRoutes } from "../src/routes/racks";
import { scanRoutes } from "../src/routes/scan";
import { statsRoutes } from "../src/routes/stats";
import { meRoutes } from "../src/routes/me";
import { publicRoutes } from "../src/routes/public";
import { qrRoutes } from "../src/routes/qr";
import { AppError } from "../src/services/borrowService";
import { ZodError } from "zod";
import { sql, eq } from "drizzle-orm";
import "../src/types";

/* =====================================================
   Database connectivity check
===================================================== */

let _dbAvailable: boolean | null = null;

export async function isDatabaseAvailable(): Promise<boolean> {
  if (_dbAvailable !== null) return _dbAvailable;
  try {
    await db.execute(sql`SELECT 1`);
    _dbAvailable = true;
  } catch {
    _dbAvailable = false;
  }
  return _dbAvailable;
}

/**
 * Use in describe blocks that need a DB:
 *   const { describe: dbDescribe, ... } = await getDbTestHelpers();
 *   dbDescribe("...", () => { ... });
 *
 * Or simply call skipIfNoDb() in beforeAll.
 */
export async function skipIfNoDb() {
  const available = await isDatabaseAvailable();
  if (!available) {
    console.warn("⚠ PostgreSQL not available — skipping integration tests");
    // Will cause tests to be marked as todo/skipped
  }
  return available;
}

/* =====================================================
   Test user fixtures
===================================================== */

export const TEST_USER = {
  id: "test-user-001",
  name: "Test User",
  email: "test@example.com",
  emailVerified: false,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const TEST_USER_2 = {
  id: "test-user-002",
  name: "Second User",
  email: "test2@example.com",
  emailVerified: false,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/* =====================================================
   Build a test-ready Fastify instance
   - Injects req.user on every request (simulates auth)
   - Registers all routes
   - Sets up the global error handler
===================================================== */

export async function buildTestApp(authenticatedUser = TEST_USER): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Error handler — MUST be set BEFORE registering routes so encapsulated plugins inherit it
  app.setErrorHandler((error: any, _req, reply) => {
    if (error instanceof ZodError || error.name === "ZodError") {
      return reply.status(400).send({
        error: "Validation Error",
        details: (error.errors ?? []).map((e: any) => ({
          path: e.path.join("."),
          message: e.message,
        })),
      });
    }
    if (error instanceof AppError || error?.constructor?.name === "AppError") {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    return reply.status(500).send({ error: "Internal Server Error" });
  });

  // Mock auth: attach user to every request
  app.addHook("onRequest", async (req) => {
    req.user = authenticatedUser as any;
    req.session = { id: "test-session", userId: authenticatedUser.id } as any;
  });

  // Register all routes
  await app.register(publicRoutes); // Public routes (no auth)
  await app.register(bookRoutes);
  await app.register(copyRoutes);
  await app.register(borrowRoutes);
  await app.register(rackRoutes);
  await app.register(scanRoutes);
  await app.register(statsRoutes);
  await app.register(meRoutes);
  await app.register(qrRoutes);

  await app.ready();
  return app;
}

/* =====================================================
   Database helpers
===================================================== */

/** Wipe all application data (preserving schema) */
export async function cleanDatabase() {
  await db.delete(borrows);
  await db.delete(bookCopies);
  await db.delete(books);
  await db.delete(racks);
  await db.delete(qrLabels);
  await db.delete(user);
}

/** Seed the two test users */
export async function seedUsers() {
  await db.insert(user).values(TEST_USER).onConflictDoNothing();
  await db.insert(user).values(TEST_USER_2).onConflictDoNothing();
}

/** Seed a book and return it */
export async function seedBook(overrides: Partial<typeof books.$inferInsert> = {}) {
  const [book] = await db
    .insert(books)
    .values({
      title: "Test Book",
      author: "Test Author",
      isbn: "978-0-13-468599-1",
      publishedYear: 2023,
      ...overrides,
    })
    .returning();
  return book!;
}

/** Seed a rack and return it */
export async function seedRack(id = "0A1K9X", overrides: Partial<typeof racks.$inferInsert> = {}) {
  const [rack] = await db
    .insert(racks)
    .values({
      id,
      room: "Room A",
      cupboard: "Cupboard 1",
      rackNumber: "R01",
      ...overrides,
    })
    .returning();
  return rack!;
}

/** Seed a book copy and return it */
export async function seedCopy(
  bookId: string,
  id = "9F3T8M",
  overrides: Partial<typeof bookCopies.$inferInsert> = {}
) {
  const [copy] = await db
    .insert(bookCopies)
    .values({
      id,
      bookId,
      state: "available",
      ...overrides,
    })
    .returning();
  return copy!;
}

/** Seed a borrow record and return it */
export async function seedBorrow(
  copyId: string,
  userId: string,
  overrides: Partial<typeof borrows.$inferInsert> = {}
) {
  const [borrow] = await db
    .insert(borrows)
    .values({
      copyId,
      userId,
      borrowedAt: new Date(),
      ...overrides,
    })
    .returning();
  return borrow!;
}
