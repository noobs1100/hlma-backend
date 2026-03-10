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
   QR Scan Routes Tests
===================================================== */

describe("Scan Routes", () => {
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

  /* ----- GET /scan/book/:copyId ----- */

  describe("GET /scan/book/:copyId", () => {
    test("returns full info for available copy with rack", async () => {
      if (!dbAvailable) return;
      const rack = await seedRack("0A1K9X", { room: "Library Hall" });
      const book = await seedBook({ title: "Scanned Book", author: "Author X", isbn: "123" });
      await seedCopy(book.id, "9F3T8M", { rackId: "0A1K9X" });

      const res = await app.inject({
        method: "GET",
        url: "/scan/book/9F3T8M",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.copyId).toBe("9F3T8M");
      expect(body.state).toBe("available");
      expect(body.book.title).toBe("Scanned Book");
      expect(body.book.author).toBe("Author X");
      expect(body.rack).not.toBeNull();
      expect(body.rack.room).toBe("Library Hall");
      expect(body.borrower).toBeNull();
    });

    test("returns borrower info for borrowed copy", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "Borrowed Book" });
      await seedCopy(book.id, "9F3T8M", {
        state: "borrowed",
        borrowedBy: TEST_USER.id,
      });
      await seedBorrow("9F3T8M", TEST_USER.id);

      const res = await app.inject({
        method: "GET",
        url: "/scan/book/9F3T8M",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.state).toBe("borrowed");
      expect(body.borrower).not.toBeNull();
      expect(body.borrower.userName).toBe(TEST_USER.name);
      expect(body.borrower.userEmail).toBe(TEST_USER.email);
    });

    test("returns null rack when copy has no rack", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M"); // no rack

      const res = await app.inject({
        method: "GET",
        url: "/scan/book/9F3T8M",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().rack).toBeNull();
    });

    test("returns unregistered status for non-existent copy", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: "/scan/book/ZZZZZZ",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("unregistered");
      expect(body.id).toBe("ZZZZZZ");
    });

    test("rejects invalid Base32 ID", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: "/scan/book/abc123",
      });

      expect(res.statusCode).toBe(400);
    });
  });

  /* ----- GET /scan/rack/:rackId ----- */

  describe("GET /scan/rack/:rackId", () => {
    test("returns rack info with expected books", async () => {
      if (!dbAvailable) return;
      const rack = await seedRack("0A1K9X", { room: "Reading Room" });
      const book1 = await seedBook({ title: "Book A" });
      const book2 = await seedBook({ title: "Book B" });
      await seedCopy(book1.id, "9F3T8M", { rackId: "0A1K9X" });
      await seedCopy(book2.id, "1Z7QKP", { rackId: "0A1K9X" });

      const res = await app.inject({
        method: "GET",
        url: "/scan/rack/0A1K9X",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rack.room).toBe("Reading Room");
      expect(body.totalCopies).toBe(2);
      expect(body.books.length).toBe(2);
      expect(body.books.map((b: any) => b.bookTitle).sort()).toEqual(["Book A", "Book B"]);
    });

    test("returns empty books for rack with no copies", async () => {
      if (!dbAvailable) return;
      await seedRack("0A1K9X");

      const res = await app.inject({
        method: "GET",
        url: "/scan/rack/0A1K9X",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().totalCopies).toBe(0);
      expect(res.json().books).toEqual([]);
    });

    test("returns unregistered status for non-existent rack", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: "/scan/rack/ZZZZZZ",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("unregistered");
      expect(body.id).toBe("ZZZZZZ");
    });
  });
});
