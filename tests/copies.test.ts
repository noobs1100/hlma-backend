import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import type { FastifyInstance } from "fastify";
import { db } from "../src/db";
import { bookCopies } from "../src/db/schema";
import { eq } from "drizzle-orm";
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
   Copy Routes Tests
===================================================== */

describe("Copy Routes", () => {
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

  /* ----- GET /copies/:copyId ----- */

  describe("GET /copies/:copyId", () => {
    test("returns copy info with book details", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "My Book", author: "Author" });
      await seedCopy(book.id, "0A1K9X");

      const res = await app.inject({
        method: "GET",
        url: "/copies/0A1K9X",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe("0A1K9X");
      expect(body.state).toBe("available");
      expect(body.book).toBeDefined();
      expect(body.book.title).toBe("My Book");
    });

    test("returns 404 for non-existent copy", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: "/copies/ZZZZZZ",
      });

      expect(res.statusCode).toBe(404);
    });

    test("rejects invalid Base32 ID in param", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: "/copies/bad!!",
      });

      expect(res.statusCode).toBe(400);
    });
  });

  /* ----- PATCH /copies/:copyId ----- */

  describe("PATCH /copies/:copyId", () => {
    test("updates rack assignment", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      const rack = await seedRack("0A1K9X");
      await seedCopy(book.id, "9F3T8M");

      const res = await app.inject({
        method: "PATCH",
        url: "/copies/9F3T8M",
        payload: { rackId: "0A1K9X" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().rackId).toBe("0A1K9X");
    });

    test("clears rack assignment with null", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      const rack = await seedRack("0A1K9X");
      await seedCopy(book.id, "9F3T8M", { rackId: "0A1K9X" });

      const res = await app.inject({
        method: "PATCH",
        url: "/copies/9F3T8M",
        payload: { rackId: null },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().rackId).toBeNull();
    });

    test("returns 404 for non-existent copy", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "PATCH",
        url: "/copies/ZZZZZZ",
        payload: { rackId: null },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  /* ----- DELETE /copies/:copyId ----- */

  describe("DELETE /copies/:copyId", () => {
    test("deletes an available copy", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M");

      const res = await app.inject({
        method: "DELETE",
        url: "/copies/9F3T8M",
      });

      expect(res.statusCode).toBe(204);
    });

    test("cannot delete a borrowed copy", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M", {
        state: "borrowed",
        borrowedBy: TEST_USER.id,
      });

      const res = await app.inject({
        method: "DELETE",
        url: "/copies/9F3T8M",
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain("borrowed");
    });

    test("returns 404 for non-existent copy", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "DELETE",
        url: "/copies/ZZZZZZ",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  /* ----- PATCH /copies/:copyId/state ----- */

  describe("PATCH /copies/:copyId/state", () => {
    test("updates state to lost", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M");

      const res = await app.inject({
        method: "PATCH",
        url: "/copies/9F3T8M/state",
        payload: { state: "lost" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe("lost");
    });

    test("updates state to returned_pending", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M", { state: "borrowed" });

      const res = await app.inject({
        method: "PATCH",
        url: "/copies/9F3T8M/state",
        payload: { state: "returned_pending" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe("returned_pending");
    });

    test("rejects invalid state", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M");

      const res = await app.inject({
        method: "PATCH",
        url: "/copies/9F3T8M/state",
        payload: { state: "destroyed" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  /* ----- POST /copies/:copyId/borrow ----- */

  describe("POST /copies/:copyId/borrow", () => {
    test("borrows an available copy for current user", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M");

      const res = await app.inject({
        method: "POST",
        url: "/copies/9F3T8M/borrow",
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().copyId).toBe("9F3T8M");
      expect(res.json().userId).toBe(TEST_USER.id);

      // Verify copy state was updated
      const [copy] = await db
        .select()
        .from(bookCopies)
        .where(eq(bookCopies.id, "9F3T8M"));
      expect(copy!.state).toBe("borrowed");
      expect(copy!.borrowedBy).toBe(TEST_USER.id);
    });

    test("borrows for a specified user", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M");

      const res = await app.inject({
        method: "POST",
        url: "/copies/9F3T8M/borrow",
        payload: { userId: TEST_USER_2.id },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().userId).toBe(TEST_USER_2.id);
    });

    test("cannot borrow already borrowed copy", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M", {
        state: "borrowed",
        borrowedBy: TEST_USER.id,
      });
      await seedBorrow("9F3T8M", TEST_USER.id);

      const res = await app.inject({
        method: "POST",
        url: "/copies/9F3T8M/borrow",
      });

      expect(res.statusCode).toBe(409);
    });

    test("cannot borrow a lost copy", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M", { state: "lost" });

      const res = await app.inject({
        method: "POST",
        url: "/copies/9F3T8M/borrow",
      });

      expect(res.statusCode).toBe(409);
    });

    test("returns 404 for non-existent copy", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/copies/ZZZZZZ/borrow",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  /* ----- POST /copies/:copyId/return ----- */

  describe("POST /copies/:copyId/return", () => {
    test("returns a borrowed copy", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M", {
        state: "borrowed",
        borrowedBy: TEST_USER.id,
      });
      await seedBorrow("9F3T8M", TEST_USER.id);

      const res = await app.inject({
        method: "POST",
        url: "/copies/9F3T8M/return",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().returnedAt).toBeDefined();

      // Verify copy state
      const [copy] = await db
        .select()
        .from(bookCopies)
        .where(eq(bookCopies.id, "9F3T8M"));
      expect(copy!.state).toBe("returned_pending");
      expect(copy!.borrowedBy).toBeNull();
    });

    test("cannot return a copy that is not borrowed", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M");

      const res = await app.inject({
        method: "POST",
        url: "/copies/9F3T8M/return",
      });

      expect(res.statusCode).toBe(409);
    });
  });

  /* ----- POST /copies/:copyId/transfer ----- */

  describe("POST /copies/:copyId/transfer", () => {
    test("transfers book to another user", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M", {
        state: "borrowed",
        borrowedBy: TEST_USER.id,
      });
      await seedBorrow("9F3T8M", TEST_USER.id);

      const res = await app.inject({
        method: "POST",
        url: "/copies/9F3T8M/transfer",
        payload: { toUserId: TEST_USER_2.id },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().userId).toBe(TEST_USER_2.id);

      // Verify copy updated
      const [copy] = await db
        .select()
        .from(bookCopies)
        .where(eq(bookCopies.id, "9F3T8M"));
      expect(copy!.borrowedBy).toBe(TEST_USER_2.id);
    });

    test("cannot transfer a non-borrowed copy", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M");

      const res = await app.inject({
        method: "POST",
        url: "/copies/9F3T8M/transfer",
        payload: { toUserId: TEST_USER_2.id },
      });

      expect(res.statusCode).toBe(409);
    });

    test("cannot transfer to non-existent user", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M", {
        state: "borrowed",
        borrowedBy: TEST_USER.id,
      });
      await seedBorrow("9F3T8M", TEST_USER.id);

      const res = await app.inject({
        method: "POST",
        url: "/copies/9F3T8M/transfer",
        payload: { toUserId: "nonexistent-user" },
      });

      expect(res.statusCode).toBe(404);
    });

    test("rejects transfer without toUserId", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/copies/9F3T8M/transfer",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  /* ----- GET /copies/:copyId/history ----- */

  describe("GET /copies/:copyId/history", () => {
    test("returns borrow history for a copy", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M");

      // Create returned borrow
      await seedBorrow("9F3T8M", TEST_USER.id, {
        returnedAt: new Date(),
      });
      // Create another borrow
      await seedBorrow("9F3T8M", TEST_USER_2.id, {
        returnedAt: new Date(),
      });

      const res = await app.inject({
        method: "GET",
        url: "/copies/9F3T8M/history",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(2);
    });

    test("returns empty for copy with no borrows", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M");

      const res = await app.inject({
        method: "GET",
        url: "/copies/9F3T8M/history",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json() as any).toEqual([]);
    });
  });
});
