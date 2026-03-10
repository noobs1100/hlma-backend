import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  cleanDatabase,
  seedUsers,
  seedBook,
  seedCopy,
  seedRack,
  skipIfNoDb,
} from "./setup";

/* =====================================================
   Book Routes Tests
===================================================== */

describe("Book Routes", () => {
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

  /* ----- POST /books ----- */

  describe("POST /books", () => {
    test("creates a book with valid data", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: {
          title: "Clean Architecture",
          author: "Robert C. Martin",
          isbn: "978-0134494166",
          publishedYear: 2017,
          description: "A guide to software architecture",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.title).toBe("Clean Architecture");
      expect(body.author).toBe("Robert C. Martin");
      expect(body.isbn).toBe("978-0134494166");
      expect(body.publishedYear).toBe(2017);
    });

    test("creates a book with only title", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: { title: "Minimal Book" },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().title).toBe("Minimal Book");
      expect(res.json().author).toBeNull();
    });

    test("rejects empty title", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: { title: "" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation Error");
    });

    test("rejects missing title", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: { author: "Someone" },
      });

      expect(res.statusCode).toBe(400);
    });

    test("rejects invalid publishedYear", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: { title: "Book", publishedYear: -1 },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  /* ----- GET /books ----- */

  describe("GET /books", () => {
    test("returns empty list when no books", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({ method: "GET", url: "/books" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
      expect(body.pagination.page).toBe(1);
    });

    test("returns paginated results", async () => {
      if (!dbAvailable) return;
      // Seed 3 books
      for (let i = 0; i < 3; i++) {
        await seedBook({ title: `Book ${i}` });
      }

      const res = await app.inject({
        method: "GET",
        url: "/books?page=1&limit=2",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(2);
      expect(body.pagination.total).toBe(3);
      expect(body.pagination.totalPages).toBe(2);
    });

    test("supports search by title", async () => {
      if (!dbAvailable) return;
      await seedBook({ title: "JavaScript Patterns" });
      await seedBook({ title: "Python Cookbook" });

      const res = await app.inject({
        method: "GET",
        url: "/books?search=JavaScript",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(1);
      expect(body.data[0].title).toBe("JavaScript Patterns");
    });

    test("supports search by author", async () => {
      if (!dbAvailable) return;
      await seedBook({ title: "Book A", author: "Martin Fowler" });
      await seedBook({ title: "Book B", author: "Kent Beck" });

      const res = await app.inject({
        method: "GET",
        url: "/books?search=Fowler",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBe(1);
      expect(res.json().data[0].author).toBe("Martin Fowler");
    });

    test("supports search by ISBN", async () => {
      if (!dbAvailable) return;
      await seedBook({ title: "A", isbn: "978-ABC" });
      await seedBook({ title: "B", isbn: "978-XYZ" });

      const res = await app.inject({
        method: "GET",
        url: "/books?search=978-ABC",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBe(1);
    });
  });

  /* ----- GET /books/:bookId ----- */

  describe("GET /books/:bookId", () => {
    test("returns book by id", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "Found Book" });

      const res = await app.inject({
        method: "GET",
        url: `/books/${book.id}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().title).toBe("Found Book");
    });

    test("returns 404 for non-existent book", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: "/books/00000000-0000-0000-0000-000000000000",
      });

      expect(res.statusCode).toBe(404);
    });

    test("returns 400 for invalid UUID", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: "/books/not-a-uuid",
      });

      expect(res.statusCode).toBe(400);
    });
  });

  /* ----- PATCH /books/:bookId ----- */

  describe("PATCH /books/:bookId", () => {
    test("updates book fields", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "Old Title" });

      const res = await app.inject({
        method: "PATCH",
        url: `/books/${book.id}`,
        payload: { title: "New Title", author: "New Author" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().title).toBe("New Title");
      expect(res.json().author).toBe("New Author");
    });

    test("returns 404 for non-existent book", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "PATCH",
        url: "/books/00000000-0000-0000-0000-000000000000",
        payload: { title: "Updated" },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  /* ----- DELETE /books/:bookId ----- */

  describe("DELETE /books/:bookId", () => {
    test("deletes a book", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();

      const res = await app.inject({
        method: "DELETE",
        url: `/books/${book.id}`,
      });

      expect(res.statusCode).toBe(204);

      // Verify it's gone
      const getRes = await app.inject({
        method: "GET",
        url: `/books/${book.id}`,
      });
      expect(getRes.statusCode).toBe(404);
    });

    test("returns 404 for non-existent book", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "DELETE",
        url: "/books/00000000-0000-0000-0000-000000000000",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  /* ----- GET /books/:bookId/copies ----- */

  describe("GET /books/:bookId/copies", () => {
    test("lists copies of a book", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");
      await seedCopy(book.id, "1Z7QKP");

      const res = await app.inject({
        method: "GET",
        url: `/books/${book.id}/copies`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(2);
    });

    test("returns empty when no copies", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();

      const res = await app.inject({
        method: "GET",
        url: `/books/${book.id}/copies`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json() as any).toEqual([]);
    });

    test("returns 404 for non-existent book", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: "/books/00000000-0000-0000-0000-000000000000/copies",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  /* ----- POST /books/:bookId/copies ----- */

  describe("POST /books/:bookId/copies", () => {
    test("creates a copy with valid Base32 ID", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();

      const res = await app.inject({
        method: "POST",
        url: `/books/${book.id}/copies`,
        payload: { id: "9F3T8M" },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().id).toBe("9F3T8M");
      expect(res.json().bookId).toBe(book.id);
      expect(res.json().state).toBe("available");
    });

    test("creates a copy with rack assignment", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      const rack = await seedRack("0A1K9X");

      const res = await app.inject({
        method: "POST",
        url: `/books/${book.id}/copies`,
        payload: { id: "9F3T8M", rackId: rack.id },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().rackId).toBe("0A1K9X");
    });

    test("rejects invalid Base32 ID", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();

      const res = await app.inject({
        method: "POST",
        url: `/books/${book.id}/copies`,
        payload: { id: "invalid" },
      });

      expect(res.statusCode).toBe(400);
    });

    test("rejects lowercase Base32 ID", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();

      const res = await app.inject({
        method: "POST",
        url: `/books/${book.id}/copies`,
        payload: { id: "0a1k9x" },
      });

      expect(res.statusCode).toBe(400);
    });

    test("returns 404 for non-existent book", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/books/00000000-0000-0000-0000-000000000000/copies",
        payload: { id: "9F3T8M" },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
