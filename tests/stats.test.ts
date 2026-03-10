import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  cleanDatabase,
  seedUsers,
  seedBook,
  seedCopy,
  seedRack,
  seedBorrow,
  TEST_USER,
  TEST_USER_2,
  skipIfNoDb,
} from "./setup";

/* =====================================================
   Stats & Jobs Routes Tests
===================================================== */

describe("Stats Routes", () => {
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

  /* ----- GET /stats/library ----- */

  describe("GET /stats/library", () => {
    test("returns library statistics", async () => {
      if (!dbAvailable) return;
      const rack = await seedRack("0A1K9X");
      const book1 = await seedBook({ title: "Book 1" });
      const book2 = await seedBook({ title: "Book 2" });
      await seedCopy(book1.id, "9F3T8M", { state: "available", rackId: "0A1K9X" });
      await seedCopy(book2.id, "1Z7QKP", { state: "borrowed", borrowedBy: TEST_USER.id });
      await seedBorrow("1Z7QKP", TEST_USER.id);

      const res = await app.inject({
        method: "GET",
        url: "/stats/library",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalBooks).toBe(2);
      expect(body.totalCopies).toBe(2);
      expect(body.totalRacks).toBe(1);
      expect(body.activeBorrows).toBe(1);
      expect(body.totalUsers).toBe(2); // TEST_USER and TEST_USER_2
      expect(body.copyStateBreakdown).toBeDefined();
      expect(Array.isArray(body.copyStateBreakdown)).toBe(true);
    });

    test("returns zeros when library is empty", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: "/stats/library",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalBooks).toBe(0);
      expect(body.totalCopies).toBe(0);
      expect(body.totalRacks).toBe(0);
      expect(body.activeBorrows).toBe(0);
    });
  });

  /* ----- GET /stats/books/popular ----- */

  describe("GET /stats/books/popular", () => {
    test("returns most borrowed books", async () => {
      if (!dbAvailable) return;
      const bookA = await seedBook({ title: "Popular Book" });
      const bookB = await seedBook({ title: "Less Popular" });
      await seedCopy(bookA.id, "9F3T8M");
      await seedCopy(bookB.id, "1Z7QKP");

      // BookA borrowed 2 times (returned)
      await seedBorrow("9F3T8M", TEST_USER.id, { returnedAt: new Date() });
      await seedBorrow("9F3T8M", TEST_USER_2.id, { returnedAt: new Date() });
      // BookB borrowed 1 time
      await seedBorrow("1Z7QKP", TEST_USER.id, { returnedAt: new Date() });

      const res = await app.inject({
        method: "GET",
        url: "/stats/books/popular?limit=5",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.length).toBeGreaterThanOrEqual(2);
      expect(body[0].title).toBe("Popular Book");
      expect(body[0].borrowCount).toBe(2);
    });

    test("returns empty when no borrows", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: "/stats/books/popular",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json() as any).toEqual([]);
    });
  });

  /* ----- GET /stats/books/never-borrowed ----- */

  describe("GET /stats/books/never-borrowed", () => {
    test("returns books never borrowed", async () => {
      if (!dbAvailable) return;
      const bookA = await seedBook({ title: "Borrowed One" });
      const bookB = await seedBook({ title: "Never Borrowed" });
      await seedCopy(bookA.id, "9F3T8M");
      await seedBorrow("9F3T8M", TEST_USER.id, { returnedAt: new Date() });

      // bookB has no copies or borrows

      const res = await app.inject({
        method: "GET",
        url: "/stats/books/never-borrowed",
      });

      expect(res.statusCode).toBe(200);
      const titles = res.json().map((b: any) => b.title);
      expect(titles).toContain("Never Borrowed");
      expect(titles).not.toContain("Borrowed One");
    });
  });

  /* ----- GET /stats/overdue ----- */

  describe("GET /stats/overdue", () => {
    test("returns overdue borrows (>14 days)", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "Overdue Book" });
      await seedCopy(book.id, "9F3T8M", { state: "borrowed", borrowedBy: TEST_USER.id });
      // Borrow from 30 days ago (overdue)
      await seedBorrow("9F3T8M", TEST_USER.id, {
        borrowedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      });

      const res = await app.inject({
        method: "GET",
        url: "/stats/overdue",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(1);
      expect(res.json()[0].bookTitle).toBe("Overdue Book");
    });

    test("does not include recent borrows", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M", { state: "borrowed", borrowedBy: TEST_USER.id });
      await seedBorrow("9F3T8M", TEST_USER.id); // today

      const res = await app.inject({
        method: "GET",
        url: "/stats/overdue",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(0);
    });
  });

  /* ----- POST /jobs/send-reminders ----- */

  describe("POST /jobs/send-reminders", () => {
    test("returns overdue reminders list", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "Late Book" });
      await seedCopy(book.id, "9F3T8M", { state: "borrowed", borrowedBy: TEST_USER.id });
      await seedBorrow("9F3T8M", TEST_USER.id, {
        borrowedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      });

      const res = await app.inject({
        method: "POST",
        url: "/jobs/send-reminders",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().reminders.length).toBe(1);
      expect(res.json().reminders[0].bookTitle).toBe("Late Book");
      expect(res.json().reminders[0].userEmail).toBe(TEST_USER.email);
    });

    test("returns empty when no overdue borrows", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/jobs/send-reminders",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().reminders).toEqual([]);
    });
  });
});
