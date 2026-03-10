import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  cleanDatabase,
  seedUsers,
  seedBook,
  seedCopy,
  seedBorrow,
  TEST_USER,
  skipIfNoDb,
} from "./setup";

/* =====================================================
   /me/* Routes Tests
===================================================== */

describe("Me Routes", () => {
  let dbAvailable = false;
  let app: FastifyInstance;

  beforeAll(async () => {
    dbAvailable = await skipIfNoDb();
    if (!dbAvailable) return;
    app = await buildTestApp();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await cleanDatabase();
    await seedUsers();
  });

  /* ----- GET /me/borrows ----- */

  describe("GET /me/borrows", () => {
    test("returns active borrows for authenticated user", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "My Borrowed Book" });
      await seedCopy(book.id, "9F3T8M", { state: "borrowed", borrowedBy: TEST_USER.id });
      await seedBorrow("9F3T8M", TEST_USER.id);

      const res = await app.inject({
        method: "GET",
        url: "/me/borrows",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(1);
      expect(res.json()[0].book.title).toBe("My Borrowed Book");
    });

    test("returns empty when user has no borrows", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: "/me/borrows",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json() as any).toEqual([]);
    });

    test("excludes returned borrows", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M");
      await seedBorrow("9F3T8M", TEST_USER.id, { returnedAt: new Date() });

      const res = await app.inject({
        method: "GET",
        url: "/me/borrows",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(0);
    });
  });

  /* ----- GET /me/history ----- */

  describe("GET /me/history", () => {
    test("returns full borrow history for authenticated user", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M");
      // Returned borrow
      await seedBorrow("9F3T8M", TEST_USER.id, { returnedAt: new Date() });

      const res = await app.inject({
        method: "GET",
        url: "/me/history",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(1);
    });

    test("supports pagination", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M");

      for (let i = 0; i < 3; i++) {
        await seedBorrow("9F3T8M", TEST_USER.id, {
          returnedAt: new Date(),
          borrowedAt: new Date(Date.now() - i * 100000),
        });
      }

      const res = await app.inject({
        method: "GET",
        url: "/me/history?limit=2",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(2);
    });
  });

  /* ----- POST /me/borrow/:copyId ----- */

  describe("POST /me/borrow/:copyId", () => {
    test("borrows a book for the authenticated user", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M");

      const res = await app.inject({
        method: "POST",
        url: "/me/borrow/9F3T8M",
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().userId).toBe(TEST_USER.id);
      expect(res.json().copyId).toBe("9F3T8M");
    });

    test("cannot borrow already-borrowed copy", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M", { state: "borrowed", borrowedBy: TEST_USER.id });
      await seedBorrow("9F3T8M", TEST_USER.id);

      const res = await app.inject({
        method: "POST",
        url: "/me/borrow/9F3T8M",
      });

      expect(res.statusCode).toBe(409);
    });

    test("returns 404 for non-existent copy", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/me/borrow/ZZZZZZ",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  /* ----- POST /me/return/:copyId ----- */

  describe("POST /me/return/:copyId", () => {
    test("returns a borrowed book", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M", { state: "borrowed", borrowedBy: TEST_USER.id });
      await seedBorrow("9F3T8M", TEST_USER.id);

      const res = await app.inject({
        method: "POST",
        url: "/me/return/9F3T8M",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().returnedAt).toBeDefined();
    });

    test("cannot return a non-borrowed copy", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M");

      const res = await app.inject({
        method: "POST",
        url: "/me/return/9F3T8M",
      });

      expect(res.statusCode).toBe(409);
    });
  });
});
