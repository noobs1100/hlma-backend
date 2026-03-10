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
  TEST_USER_2,
  skipIfNoDb,
} from "./setup";

/* =====================================================
   Borrow Routes Tests
===================================================== */

describe("Borrow Routes", () => {
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

  /* ----- GET /users/:userId/borrows ----- */

  describe("GET /users/:userId/borrows", () => {
    test("returns active borrows for a user", async () => {
      if (!dbAvailable) return;
      const book1 = await seedBook({ title: "Book 1" });
      const book2 = await seedBook({ title: "Book 2" });
      await seedCopy(book1.id, "0A1K9X", { state: "borrowed", borrowedBy: TEST_USER.id });
      await seedCopy(book2.id, "1Z7QKP", { state: "borrowed", borrowedBy: TEST_USER.id });
      await seedBorrow("0A1K9X", TEST_USER.id);
      await seedBorrow("1Z7QKP", TEST_USER.id);

      const res = await app.inject({
        method: "GET",
        url: `/users/${TEST_USER.id}/borrows`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(2);
    });

    test("excludes returned borrows", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");
      await seedBorrow("0A1K9X", TEST_USER.id, { returnedAt: new Date() });

      const res = await app.inject({
        method: "GET",
        url: `/users/${TEST_USER.id}/borrows`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(0);
    });

    test("returns empty for user with no borrows", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: `/users/${TEST_USER.id}/borrows`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json() as any).toEqual([]);
    });
  });

  /* ----- GET /users/:userId/history ----- */

  describe("GET /users/:userId/history", () => {
    test("returns full borrow history including returned", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");
      await seedBorrow("0A1K9X", TEST_USER.id, { returnedAt: new Date() });
      // Active borrow on a different copy
      const book2 = await seedBook({ title: "Book 2" });
      await seedCopy(book2.id, "1Z7QKP", { state: "borrowed", borrowedBy: TEST_USER.id });
      await seedBorrow("1Z7QKP", TEST_USER.id);

      const res = await app.inject({
        method: "GET",
        url: `/users/${TEST_USER.id}/history`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(2);
    });

    test("supports pagination", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");

      // Seed 3 returned borrows
      for (let i = 0; i < 3; i++) {
        await seedBorrow("0A1K9X", TEST_USER.id, {
          returnedAt: new Date(),
          borrowedAt: new Date(Date.now() - i * 100000),
        });
      }

      const res = await app.inject({
        method: "GET",
        url: `/users/${TEST_USER.id}/history?page=1&limit=2`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(2);
    });
  });

  /* ----- GET /borrows/:borrowId ----- */

  describe("GET /borrows/:borrowId", () => {
    test("returns borrow record with details", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "Target Book" });
      await seedCopy(book.id, "0A1K9X", { state: "borrowed", borrowedBy: TEST_USER.id });
      const borrow = await seedBorrow("0A1K9X", TEST_USER.id);

      const res = await app.inject({
        method: "GET",
        url: `/borrows/${borrow.id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.borrow.id).toBe(borrow.id);
      expect(body.book.title).toBe("Target Book");
      expect(body.userName).toBe(TEST_USER.name);
    });

    test("returns 404 for non-existent borrow", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: "/borrows/00000000-0000-0000-0000-000000000000",
      });

      expect(res.statusCode).toBe(404);
    });

    test("returns 400 for invalid UUID", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: "/borrows/not-a-uuid",
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
