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
  skipIfNoDb,
} from "./setup";

/* =====================================================
   Public Routes Tests - No Authentication Required
===================================================== */

describe("Public Routes", () => {
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

  /* ----- GET /public/book/:copyId ----- */

  describe("GET /public/book/:copyId", () => {
    test("returns book info for available copy", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({
        title: "Public Book",
        author: "Public Author",
        isbn: "978-PUBLIC",
        description: "A book for everyone",
        publishedYear: 2024,
      });
      const rack = await seedRack("0A1K9X", {
        room: "Main Library",
        cupboard: "Section A",
        rackNumber: "R1",
      });
      await seedCopy(book.id, "9F3T8M", { rackId: "0A1K9X" });

      const res = await app.inject({
        method: "GET",
        url: "/public/book/9F3T8M",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.copyId).toBe("9F3T8M");
      expect(body.book.title).toBe("Public Book");
      expect(body.book.author).toBe("Public Author");
      expect(body.book.isbn).toBe("978-PUBLIC");
      expect(body.book.description).toBe("A book for everyone");
      expect(body.book.publishedYear).toBe(2024);

      expect(body.status.state).toBe("available");
      expect(body.status.message).toBe("Available for borrowing");
      expect(body.status.isAvailable).toBe(true);
      expect(body.status.borrowedAt).toBeNull();

      expect(body.location).toBe("Main Library → Section A → Rack R1");
    });

    test("returns borrowed status without user details (privacy)", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "Borrowed Book" });
      await seedCopy(book.id, "9F3T8M", {
        state: "borrowed",
        borrowedBy: TEST_USER.id,
        borrowedAt: new Date(),
      });
      await seedBorrow("9F3T8M", TEST_USER.id);

      const res = await app.inject({
        method: "GET",
        url: "/public/book/9F3T8M",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.status.state).toBe("borrowed");
      expect(body.status.message).toBe("Currently borrowed");
      expect(body.status.isAvailable).toBe(false);
      expect(body.status.borrowedAt).toBeDefined();

      // Should NOT include borrower info
      expect(body.borrower).toBeUndefined();
      expect(body.userName).toBeUndefined();
      expect(body.userEmail).toBeUndefined();
    });

    test("returns lost status", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "Lost Book" });
      await seedCopy(book.id, "9F3T8M", { state: "lost" });

      const res = await app.inject({
        method: "GET",
        url: "/public/book/9F3T8M",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.status.state).toBe("lost");
      expect(body.status.message).toBe("Marked as lost");
      expect(body.status.isAvailable).toBe(false);
    });

    test("returns returned_pending status", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "Returning Book" });
      await seedCopy(book.id, "9F3T8M", { state: "returned_pending" });

      const res = await app.inject({
        method: "GET",
        url: "/public/book/9F3T8M",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.status.state).toBe("returned_pending");
      expect(body.status.message).toBe("Being returned - check back soon");
      expect(body.status.isAvailable).toBe(false);
    });

    test("returns null location when no rack assigned", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "No Rack Book" });
      await seedCopy(book.id, "9F3T8M"); // No rackId

      const res = await app.inject({
        method: "GET",
        url: "/public/book/9F3T8M",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().location).toBeNull();
    });

    test("returns unregistered status for non-existent copy", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/public/book/ZZZZZZ",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("unregistered");
      expect(body.id).toBe("ZZZZZZ");
      expect(body.message).toContain("not been registered");
    });

    test("returns 400 for invalid Base32 ID", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/public/book/invalid!",
      });

      expect(res.statusCode).toBe(400);
    });

    test("location shows only room if no cupboard/rack", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedRack("0A1K9X", { room: "Room Only", cupboard: undefined, rackNumber: undefined });
      await seedCopy(book.id, "9F3T8M", { rackId: "0A1K9X" });

      const res = await app.inject({
        method: "GET",
        url: "/public/book/9F3T8M",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().location).toBe("Room Only");
    });
  });

  /* ----- GET /public/health ----- */

  describe("GET /public/health", () => {
    test("returns health status", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/public/health",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("ok");
      expect(res.json().timestamp).toBeDefined();
    });
  });
});
