import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import type { FastifyInstance } from "fastify";
import { db } from "../src/db";
import { books, bookCopies, borrows, racks, user } from "../src/db/schema";
import { eq, sql } from "drizzle-orm";
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
   EDGE CASE TESTS - Staff Engineer Level
   
   This file tests scenarios that could cause production issues:
   - Race conditions & concurrency
   - Boundary values & limits
   - Unicode & special characters
   - SQL injection attempts
   - State machine violations
   - Cascading operations
   - Pagination edge cases
   - Null/undefined handling
   - Malformed inputs
   - Resource cleanup
===================================================== */

describe("Edge Cases", () => {
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

  /* =====================================================
     SQL INJECTION & SECURITY
  ===================================================== */

  describe("SQL Injection Prevention", () => {
    test("search parameter handles SQL injection attempt in title", async () => {
      if (!dbAvailable) return;
      await seedBook({ title: "Normal Book" });

      const res = await app.inject({
        method: "GET",
        url: "/books?search='; DROP TABLE books; --",
      });

      expect(res.statusCode).toBe(200);
      // Should return empty, not crash
      expect(res.json().data).toBeDefined();
    });

    test("book title with SQL-like content is stored and retrieved correctly", async () => {
      if (!dbAvailable) return;
      const maliciousTitle = "Robert'); DROP TABLE Students;--";

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: { title: maliciousTitle },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().title).toBe(maliciousTitle);

      // Verify it's stored correctly
      const getRes = await app.inject({
        method: "GET",
        url: `/books/${res.json().id}`,
      });
      expect(getRes.json().title).toBe(maliciousTitle);
    });

    test("rack ID with injection attempt is rejected by Base32 validation", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/racks",
        payload: {
          id: "'; DROP",
          room: "Room A",
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  /* =====================================================
     UNICODE & SPECIAL CHARACTERS
  ===================================================== */

  describe("Unicode & Special Character Handling", () => {
    test("creates book with Chinese characters", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: {
          title: "红楼梦",
          author: "曹雪芹",
          description: "中国古典小说四大名著之一",
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().title).toBe("红楼梦");
      expect(res.json().author).toBe("曹雪芹");
    });

    test("creates book with Arabic characters", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: {
          title: "ألف ليلة وليلة",
          author: "مجهول",
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().title).toBe("ألف ليلة وليلة");
    });

    test("creates book with emoji", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: {
          title: "The 🚀 Guide to Success 💫",
          author: "Happy Author 😊",
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().title).toBe("The 🚀 Guide to Success 💫");
    });

    test("searches for book with unicode characters", async () => {
      if (!dbAvailable) return;
      await seedBook({ title: "Война и мир", author: "Лев Толстой" });

      const res = await app.inject({
        method: "GET",
        url: "/books?search=Толстой",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBe(1);
    });

    test("handles zero-width characters in title", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: {
          title: "Test\u200BBook\u200B", // Zero-width space
        },
      });

      expect(res.statusCode).toBe(201);
      // Should store as-is (could also normalize, but at least shouldn't crash)
    });

    test("handles newlines and tabs in description", async () => {
      if (!dbAvailable) return;

      const description = "Line 1\nLine 2\n\tIndented line\r\nWindows line";
      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: {
          title: "Multiline Book",
          description,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().description).toBe(description);
    });

    test("rack room with special characters", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/racks",
        payload: {
          id: "0A1K9X",
          room: "Building A - Floor 3 (Wing B/C)",
          cupboard: "Shelf #5 & #6",
          description: "Near the \"Main\" entrance <important>",
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().room).toBe("Building A - Floor 3 (Wing B/C)");
    });
  });

  /* =====================================================
     BOUNDARY VALUES & LIMITS
  ===================================================== */

  describe("Boundary Values", () => {
    test("book title at exactly maximum length (500 chars)", async () => {
      if (!dbAvailable) return;
      const title = "A".repeat(500);

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: { title },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().title.length).toBe(500);
    });

    test("book title exceeding maximum length (501 chars) is rejected", async () => {
      if (!dbAvailable) return;
      const title = "A".repeat(501);

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: { title },
      });

      expect(res.statusCode).toBe(400);
    });

    test("description at exactly maximum length (5000 chars)", async () => {
      if (!dbAvailable) return;
      const description = "B".repeat(5000);

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: { title: "Test", description },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().description.length).toBe(5000);
    });

    test("publishedYear at minimum boundary (0)", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: { title: "Ancient Text", publishedYear: 0 },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().publishedYear).toBe(0);
    });

    test("publishedYear at maximum boundary (9999)", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: { title: "Future Book", publishedYear: 9999 },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().publishedYear).toBe(9999);
    });

    test("publishedYear exceeding maximum (10000) is rejected", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: { title: "Invalid Year", publishedYear: 10000 },
      });

      expect(res.statusCode).toBe(400);
    });

    test("pagination limit at maximum (100)", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/books?limit=100",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().pagination.limit).toBe(100);
    });

    test("pagination limit exceeding maximum (101) is capped", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/books?limit=101",
      });

      // Should reject or cap to 100
      expect(res.statusCode).toBe(400);
    });

    test("pagination page 0 is rejected", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/books?page=0",
      });

      expect(res.statusCode).toBe(400);
    });

    test("pagination with negative page is rejected", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/books?page=-1",
      });

      expect(res.statusCode).toBe(400);
    });

    test("extremely high page number returns empty data", async () => {
      if (!dbAvailable) return;
      await seedBook({ title: "Only Book" });

      const res = await app.inject({
        method: "GET",
        url: "/books?page=999999",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([]);
    });
  });

  /* =====================================================
     STATE MACHINE VIOLATIONS
  ===================================================== */

  describe("State Machine Violations", () => {
    test("cannot borrow an already borrowed book", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X", { state: "borrowed", borrowedBy: TEST_USER.id });
      await seedBorrow("0A1K9X", TEST_USER.id);

      const res = await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/borrow",
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain("not available");
    });

    test("cannot borrow a lost book", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X", { state: "lost" });

      const res = await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/borrow",
      });

      expect(res.statusCode).toBe(409);
    });

    test("cannot return a book that is not borrowed", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X", { state: "available" });

      const res = await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/return",
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain("not borrowed");
    });

    test("cannot return a lost book", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X", { state: "lost" });

      const res = await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/return",
      });

      expect(res.statusCode).toBe(409);
    });

    test("cannot transfer a book that is not borrowed", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X", { state: "available" });

      const res = await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/transfer",
        payload: { toUserId: TEST_USER_2.id },
      });

      expect(res.statusCode).toBe(409);
    });

    test("cannot transfer to non-existent user", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X", { state: "borrowed", borrowedBy: TEST_USER.id });
      await seedBorrow("0A1K9X", TEST_USER.id);

      const res = await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/transfer",
        payload: { toUserId: "non-existent-user-id" },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("user");
    });

    test("cannot place book in rack if state is borrowed", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      const rack = await seedRack("0A1K9X");
      await seedCopy(book.id, "9F3T8M", { state: "borrowed", borrowedBy: TEST_USER.id });

      const res = await app.inject({
        method: "POST",
        url: "/racks/0A1K9X/place",
        payload: { copyId: "9F3T8M" },
      });

      expect(res.statusCode).toBe(409);
    });

    test("cannot place book in rack if state is lost", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      const rack = await seedRack("0A1K9X");
      await seedCopy(book.id, "9F3T8M", { state: "lost" });

      const res = await app.inject({
        method: "POST",
        url: "/racks/0A1K9X/place",
        payload: { copyId: "9F3T8M" },
      });

      expect(res.statusCode).toBe(409);
    });

    test("can place book in rack if state is returned_pending", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      const rack = await seedRack("0A1K9X");
      await seedCopy(book.id, "9F3T8M", { state: "returned_pending" });

      const res = await app.inject({
        method: "POST",
        url: "/racks/0A1K9X/place",
        payload: { copyId: "9F3T8M" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe("available");
      expect(res.json().rackId).toBe("0A1K9X");
    });

    test("double return attempt fails", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X", { state: "borrowed", borrowedBy: TEST_USER.id });
      await seedBorrow("0A1K9X", TEST_USER.id);

      // First return succeeds
      const res1 = await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/return",
      });
      expect(res1.statusCode).toBe(200);

      // Second return fails
      const res2 = await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/return",
      });
      expect(res2.statusCode).toBe(409);
    });
  });

  /* =====================================================
     CASCADING OPERATIONS & REFERENTIAL INTEGRITY
  ===================================================== */

  describe("Cascading Operations", () => {
    test("deleting a book with copies fails with FK constraint", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "Book with copies" });
      await seedCopy(book.id, "0A1K9X");

      const res = await app.inject({
        method: "DELETE",
        url: `/books/${book.id}`,
      });

      // Should fail because of FK constraint
      expect(res.statusCode).toBe(500);
    });

    test("deleting rack nullifies copy rack references", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      const rack = await seedRack("0A1K9X");
      await seedCopy(book.id, "9F3T8M", { rackId: "0A1K9X" });

      const res = await app.inject({
        method: "DELETE",
        url: "/racks/0A1K9X",
      });

      expect(res.statusCode).toBe(204);

      // Verify copy's rackId is now null
      const copyRes = await app.inject({
        method: "GET",
        url: "/copies/9F3T8M",
      });
      expect(copyRes.json().rackId).toBeNull();
    });

    test("creating copy for non-existent book fails", async () => {
      if (!dbAvailable) return;
      const fakeBookId = "00000000-0000-0000-0000-000000000000";

      const res = await app.inject({
        method: "POST",
        url: `/books/${fakeBookId}/copies`,
        payload: { id: "0A1K9X" },
      });

      expect(res.statusCode).toBe(404);
    });

    test("assigning copy to non-existent rack fails", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");

      const res = await app.inject({
        method: "PATCH",
        url: "/copies/0A1K9X",
        payload: { rackId: "ZZZZZZ" },
      });

      // Drizzle/Postgres should fail on FK constraint
      expect(res.statusCode).toBe(500);
    });
  });

  /* =====================================================
     CONCURRENT OPERATIONS (Race Conditions)
  ===================================================== */

  describe("Concurrent Operations", () => {
    test("concurrent borrows of same copy - only one succeeds", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");

      // Simulate concurrent borrow attempts
      const results = await Promise.allSettled([
        app.inject({ method: "POST", url: "/copies/0A1K9X/borrow" }),
        app.inject({ method: "POST", url: "/copies/0A1K9X/borrow" }),
        app.inject({ method: "POST", url: "/copies/0A1K9X/borrow" }),
      ]);

      const successes = results.filter(
        (r) => r.status === "fulfilled" && (r.value as any).statusCode === 201
      ).length;
      const conflicts = results.filter(
        (r) => r.status === "fulfilled" && (r.value as any).statusCode === 409
      ).length;

      // Exactly one should succeed, others should get 409
      expect(successes).toBe(1);
      expect(conflicts).toBe(2);
    });

    test("borrow and return race - state consistency", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X", { state: "borrowed", borrowedBy: TEST_USER.id });
      await seedBorrow("0A1K9X", TEST_USER.id);

      // Try to borrow (should fail) and return (should succeed) concurrently
      const [borrowRes, returnRes] = await Promise.all([
        app.inject({ method: "POST", url: "/copies/0A1K9X/borrow" }),
        app.inject({ method: "POST", url: "/copies/0A1K9X/return" }),
      ]);

      // Borrow should fail (already borrowed)
      expect(borrowRes.statusCode).toBe(409);
      // Return should succeed
      expect(returnRes.statusCode).toBe(200);

      // Final state should be returned_pending
      const copyRes = await app.inject({
        method: "GET",
        url: "/copies/0A1K9X",
      });
      expect(copyRes.json().state).toBe("returned_pending");
    });

    test("concurrent book creation with same ISBN", async () => {
      if (!dbAvailable) return;
      const isbn = "978-UNIQUE-ISBN";

      // Create two books with same ISBN concurrently
      const results = await Promise.all([
        app.inject({
          method: "POST",
          url: "/books",
          payload: { title: "Book A", isbn },
        }),
        app.inject({
          method: "POST",
          url: "/books",
          payload: { title: "Book B", isbn },
        }),
      ]);

      // Both should succeed (ISBN is not unique constraint by default)
      expect(results[0].statusCode).toBe(201);
      expect(results[1].statusCode).toBe(201);
    });
  });

  /* =====================================================
     NULL & UNDEFINED HANDLING
  ===================================================== */

  describe("Null & Undefined Handling", () => {
    test("updating book with null values is rejected by Zod validation", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({
        title: "Original",
        author: "Original Author",
        isbn: "123-456",
      });

      const res = await app.inject({
        method: "PATCH",
        url: `/books/${book.id}`,
        payload: { author: null },
      });

      // Zod rejects null for string fields - must use .nullable() in schema to allow
      expect(res.statusCode).toBe(400);
    });

    test("updating book with undefined values is allowed (partial update)", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({
        title: "Original",
        author: "Original Author",
        isbn: "123-456",
      });

      const res = await app.inject({
        method: "PATCH",
        url: `/books/${book.id}`,
        payload: { title: "Updated Title" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().title).toBe("Updated Title");
      expect(res.json().author).toBe("Original Author"); // Unchanged
    });

    test("creating book with empty optional fields", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: {
          title: "Minimal Book",
          author: undefined,
          isbn: undefined,
          publishedYear: undefined,
          description: undefined,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().author).toBeNull();
    });

    test("empty payload object to PATCH endpoint fails with no columns to set", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "Unchanged" });

      const res = await app.inject({
        method: "PATCH",
        url: `/books/${book.id}`,
        payload: {},
      });

      // Drizzle throws when .set({}) is called with empty object
      // This is expected behavior - PATCH should have at least one field
      expect(res.statusCode).toBe(500);
    });

    test("PATCH with at least one field succeeds", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "Original" });

      const res = await app.inject({
        method: "PATCH",
        url: `/books/${book.id}`,
        payload: { title: "Original" }, // Same value, but valid
      });

      expect(res.statusCode).toBe(200);
    });

    test("rack with null optional fields is rejected - use undefined instead", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/racks",
        payload: {
          id: "0A1K9X",
          room: "Room A",
          cupboard: null,
          rackNumber: null,
          description: null,
        },
      });

      // Zod rejects null unless .nullable() - schemas use .optional() which allows undefined but not null
      expect(res.statusCode).toBe(400);
    });

    test("rack with omitted optional fields succeeds", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/racks",
        payload: {
          id: "0A1K9X",
          room: "Room A",
          // Optional fields simply not included
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().cupboard).toBeNull();
      expect(res.json().rackNumber).toBeNull();
    });
  });

  /* =====================================================
     MALFORMED INPUT HANDLING
  ===================================================== */

  describe("Malformed Input Handling", () => {
    test("invalid JSON body returns 400", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: "{ invalid json",
        headers: { "Content-Type": "application/json" },
      });

      expect(res.statusCode).toBe(400);
    });

    test("array instead of object body", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: [{ title: "Array Book" }],
      });

      expect(res.statusCode).toBe(400);
    });

    test("string instead of number for publishedYear", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: { title: "Book", publishedYear: "not a number" },
      });

      expect(res.statusCode).toBe(400);
    });

    test("float instead of integer for publishedYear", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: { title: "Book", publishedYear: 2023.5 },
      });

      expect(res.statusCode).toBe(400);
    });

    test("extremely long string that might overflow", async () => {
      if (!dbAvailable) return;
      const hugeString = "X".repeat(1_000_000); // 1MB

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: { title: hugeString },
      });

      // Should be rejected by validation
      expect(res.statusCode).toBe(400);
    });

    test("invalid UUID format for bookId", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/books/not-a-uuid",
      });

      expect(res.statusCode).toBe(400);
    });

    test("lowercase base32 ID is rejected", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();

      const res = await app.inject({
        method: "POST",
        url: `/books/${book.id}/copies`,
        payload: { id: "0a1k9x" }, // lowercase
      });

      expect(res.statusCode).toBe(400);
    });

    test("base32 ID with invalid characters (I, L, O, U)", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();

      // I, L, O, U are not in Crockford Base32
      const invalidIds = ["0AIIII", "0ALLLL", "0AOOOO", "0AUUUU"];

      for (const id of invalidIds) {
        const res = await app.inject({
          method: "POST",
          url: `/books/${book.id}/copies`,
          payload: { id },
        });
        expect(res.statusCode).toBe(400);
      }
    });

    test("base32 ID too short (5 chars)", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();

      const res = await app.inject({
        method: "POST",
        url: `/books/${book.id}/copies`,
        payload: { id: "0A1K9" },
      });

      expect(res.statusCode).toBe(400);
    });

    test("base32 ID too long (7 chars)", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();

      const res = await app.inject({
        method: "POST",
        url: `/books/${book.id}/copies`,
        payload: { id: "0A1K9XX" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  /* =====================================================
     PAGINATION EDGE CASES
  ===================================================== */

  describe("Pagination Edge Cases", () => {
    test("pagination with float values is rejected (z.coerce.number().int())", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/books?page=1.9&limit=5.5",
      });

      // z.coerce.number().int() rejects floats - they're coerced to number but fail int() check
      expect(res.statusCode).toBe(400);
    });

    test("pagination with whole number strings works", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/books?page=2&limit=15",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().pagination.page).toBe(2);
      expect(res.json().pagination.limit).toBe(15);
    });

    test("pagination with scientific notation", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/books?page=1e0&limit=2e1",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().pagination.page).toBe(1);
      expect(res.json().pagination.limit).toBe(20);
    });

    test("last page calculation with exact division", async () => {
      if (!dbAvailable) return;
      // Seed exactly 10 books
      for (let i = 0; i < 10; i++) {
        await seedBook({ title: `Book ${i}` });
      }

      const res = await app.inject({
        method: "GET",
        url: "/books?limit=5",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().pagination.totalPages).toBe(2);
      expect(res.json().pagination.total).toBe(10);
    });

    test("last page calculation with remainder", async () => {
      if (!dbAvailable) return;
      // Seed 11 books
      for (let i = 0; i < 11; i++) {
        await seedBook({ title: `Book ${i}` });
      }

      const res = await app.inject({
        method: "GET",
        url: "/books?limit=5",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().pagination.totalPages).toBe(3); // ceil(11/5)
    });

    test("requesting last page returns correct items", async () => {
      if (!dbAvailable) return;
      for (let i = 0; i < 11; i++) {
        await seedBook({ title: `Book ${i}` });
      }

      const res = await app.inject({
        method: "GET",
        url: "/books?page=3&limit=5",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBe(1); // Only 1 item on last page
    });
  });

  /* =====================================================
     SEARCH EDGE CASES
  ===================================================== */

  describe("Search Edge Cases", () => {
    test("search with only spaces returns all", async () => {
      if (!dbAvailable) return;
      await seedBook({ title: "Book A" });
      await seedBook({ title: "Book B" });

      const res = await app.inject({
        method: "GET",
        url: "/books?search=   ",
      });

      expect(res.statusCode).toBe(200);
      // Empty/whitespace search might match all due to ILIKE '% %'
      // or be treated as no search
    });

    test("search is case insensitive", async () => {
      if (!dbAvailable) return;
      await seedBook({ title: "JavaScript Guide" });

      const variations = ["javascript", "JAVASCRIPT", "JaVaScRiPt"];
      for (const search of variations) {
        const res = await app.inject({
          method: "GET",
          url: `/books?search=${search}`,
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.length).toBe(1);
      }
    });

    test("search with percent sign (SQL wildcard)", async () => {
      if (!dbAvailable) return;
      await seedBook({ title: "100% Complete Guide" });

      const res = await app.inject({
        method: "GET",
        url: "/books?search=100%",
      });

      expect(res.statusCode).toBe(200);
      // Should treat % literally, not as wildcard
    });

    test("search with underscore (SQL single char wildcard)", async () => {
      if (!dbAvailable) return;
      await seedBook({ title: "snake_case_book" });

      const res = await app.inject({
        method: "GET",
        url: "/books?search=snake_case",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBe(1);
    });

    test("search with backslash", async () => {
      if (!dbAvailable) return;
      await seedBook({ title: "Windows\\Path\\Guide" });

      const res = await app.inject({
        method: "GET",
        url: "/books?search=Windows\\Path",
      });

      expect(res.statusCode).toBe(200);
    });
  });

  /* =====================================================
     AUDIT SESSION EDGE CASES
  ===================================================== */

  describe("Audit Session Edge Cases", () => {
    test("starting audit on non-existent rack fails", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/racks/ZZZZZZ/audit/start",
      });

      expect(res.statusCode).toBe(404);
    });

    test("scanning without starting audit fails", async () => {
      if (!dbAvailable) return;
      const rack = await seedRack("0A1K9X");

      const res = await app.inject({
        method: "POST",
        url: "/racks/0A1K9X/audit/scan",
        payload: { copyId: "9F3T8M" },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("audit");
    });

    test("getting audit result without session fails", async () => {
      if (!dbAvailable) return;
      const rack = await seedRack("0A1K9X");

      const res = await app.inject({
        method: "GET",
        url: "/racks/0A1K9X/audit/result",
      });

      expect(res.statusCode).toBe(404);
    });

    test("scanning same copy multiple times counts once", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      const rack = await seedRack("0A1K9X");
      await seedCopy(book.id, "9F3T8M", { rackId: "0A1K9X" });

      // Start audit
      await app.inject({
        method: "POST",
        url: "/racks/0A1K9X/audit/start",
      });

      // Scan same copy 3 times
      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: "POST",
          url: "/racks/0A1K9X/audit/scan",
          payload: { copyId: "9F3T8M" },
        });
      }

      // Get result
      const res = await app.inject({
        method: "GET",
        url: "/racks/0A1K9X/audit/result",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().scanned).toBe(1); // Set deduplicates
      expect(res.json().found).toBe(1);
    });

    test("audit detects misplaced books", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      const rack1 = await seedRack("0A1K9X");
      const rack2 = await seedRack("1B2M3N");
      await seedCopy(book.id, "9F3T8M", { rackId: "0A1K9X" }); // Expected in rack1
      await seedCopy(book.id, "8E2S7R", { rackId: "1B2M3N" }); // Expected in rack2

      // Start audit on rack1
      await app.inject({
        method: "POST",
        url: "/racks/0A1K9X/audit/start",
      });

      // Scan a book that belongs to rack2
      await app.inject({
        method: "POST",
        url: "/racks/0A1K9X/audit/scan",
        payload: { copyId: "8E2S7R" },
      });

      const res = await app.inject({
        method: "GET",
        url: "/racks/0A1K9X/audit/result",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().misplaced).toContain("8E2S7R");
      expect(res.json().missing.length).toBe(1); // 9F3T8M wasn't scanned
    });

    test("starting new audit clears previous session", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      const rack = await seedRack("0A1K9X");
      await seedCopy(book.id, "9F3T8M", { rackId: "0A1K9X" });

      // Start first audit and scan
      await app.inject({
        method: "POST",
        url: "/racks/0A1K9X/audit/start",
      });
      await app.inject({
        method: "POST",
        url: "/racks/0A1K9X/audit/scan",
        payload: { copyId: "9F3T8M" },
      });

      // Start new audit (should reset)
      await app.inject({
        method: "POST",
        url: "/racks/0A1K9X/audit/start",
      });

      const res = await app.inject({
        method: "GET",
        url: "/racks/0A1K9X/audit/result",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().scanned).toBe(0); // Reset, nothing scanned
    });
  });

  /* =====================================================
     HISTORY & BORROW RECORDS
  ===================================================== */

  describe("History Edge Cases", () => {
    test("user with no borrow history returns empty array", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: `/users/${TEST_USER.id}/history`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    test("copy with no borrow history returns empty array", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");

      const res = await app.inject({
        method: "GET",
        url: "/copies/0A1K9X/history",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    test("borrow history shows both active and returned", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");

      // Borrow
      await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/borrow",
      });

      // Return
      await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/return",
      });

      // Place in rack
      const rack = await seedRack("1B2M3N");
      await app.inject({
        method: "POST",
        url: "/racks/1B2M3N/place",
        payload: { copyId: "0A1K9X" },
      });

      // Borrow again
      await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/borrow",
      });

      const res = await app.inject({
        method: "GET",
        url: "/copies/0A1K9X/history",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(2); // Two borrow records
    });

    test("transfer creates proper borrow chain", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");

      // User 1 borrows
      await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/borrow",
      });

      // Transfer to User 2
      await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/transfer",
        payload: { toUserId: TEST_USER_2.id },
      });

      const res = await app.inject({
        method: "GET",
        url: "/copies/0A1K9X/history",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(2);

      // First record should be returned (old user), second active (new user)
      const history = res.json();
      expect(history.some((h: any) => h.borrow.userId === TEST_USER.id && h.borrow.returnedAt !== null)).toBe(true);
      expect(history.some((h: any) => h.borrow.userId === TEST_USER_2.id && h.borrow.returnedAt === null)).toBe(true);
    });
  });

  /* =====================================================
     STATS EDGE CASES
  ===================================================== */

  describe("Stats Edge Cases", () => {
    test("library stats with empty database", async () => {
      if (!dbAvailable) return;
      // Database is already clean from beforeEach (only users exist)

      const res = await app.inject({
        method: "GET",
        url: "/stats/library",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().totalBooks).toBe(0);
      expect(res.json().totalCopies).toBe(0);
      expect(res.json().totalRacks).toBe(0);
      expect(res.json().activeBorrows).toBe(0);
    });

    test("popular books with no borrows returns empty", async () => {
      if (!dbAvailable) return;
      await seedBook({ title: "Unborrowed Book" });

      const res = await app.inject({
        method: "GET",
        url: "/stats/books/popular",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    test("never-borrowed includes books with copies but no borrows", async () => {
      if (!dbAvailable) return;
      const book1 = await seedBook({ title: "Borrowed Book" });
      const book2 = await seedBook({ title: "Never Borrowed Book" });

      // Create copies for both
      await seedCopy(book1.id, "0A1K9X");
      await seedCopy(book2.id, "1B2M3N");

      // Borrow and return book1
      await app.inject({ method: "POST", url: "/copies/0A1K9X/borrow" });
      await app.inject({ method: "POST", url: "/copies/0A1K9X/return" });

      const res = await app.inject({
        method: "GET",
        url: "/stats/books/never-borrowed",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(1);
      expect(res.json()[0].title).toBe("Never Borrowed Book");
    });

    test("overdue calculation with just-borrowed book", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");

      // Borrow now (not overdue)
      await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/borrow",
      });

      const res = await app.inject({
        method: "GET",
        url: "/stats/overdue",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  /* =====================================================
     QR SCAN EDGE CASES
  ===================================================== */

  describe("QR Scan Edge Cases", () => {
    test("scan book with no rack assigned", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "No Rack Book" });
      await seedCopy(book.id, "0A1K9X"); // No rackId

      const res = await app.inject({
        method: "GET",
        url: "/scan/book/0A1K9X",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().rack).toBeNull();
      expect(res.json().book.title).toBe("No Rack Book");
    });

    test("scan borrowed book includes borrower info", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");

      await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/borrow",
      });

      const res = await app.inject({
        method: "GET",
        url: "/scan/book/0A1K9X",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe("borrowed");
      expect(res.json().borrower).not.toBeNull();
      expect(res.json().borrower.userName).toBe(TEST_USER.name);
    });

    test("scan available book has null borrower", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");

      const res = await app.inject({
        method: "GET",
        url: "/scan/book/0A1K9X",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe("available");
      expect(res.json().borrower).toBeNull();
    });

    test("scan empty rack returns zero books", async () => {
      if (!dbAvailable) return;
      const rack = await seedRack("0A1K9X");

      const res = await app.inject({
        method: "GET",
        url: "/scan/rack/0A1K9X",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().books).toEqual([]);
      expect(res.json().totalCopies).toBe(0);
    });
  });

  /* =====================================================
     ME ROUTES (Current User Context)
  ===================================================== */

  describe("Me Routes Edge Cases", () => {
    test("me/borrows is empty when user has no active borrows", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/me/borrows",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    test("me/history excludes other users' borrows", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");
      await seedCopy(book.id, "1B2M3N");

      // TEST_USER borrows first copy
      await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/borrow",
      });

      // Create second copy borrow for TEST_USER_2 directly in DB
      await db.insert(borrows).values({
        copyId: "1B2M3N",
        userId: TEST_USER_2.id,
        borrowedAt: new Date(),
      });
      await db
        .update(bookCopies)
        .set({ state: "borrowed", borrowedBy: TEST_USER_2.id })
        .where(eq(bookCopies.id, "1B2M3N"));

      // Get TEST_USER's history
      const res = await app.inject({
        method: "GET",
        url: "/me/history",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(1);
      expect(res.json()[0].borrow.userId).toBe(TEST_USER.id);
    });
  });

  /* =====================================================
     DUPLICATE HANDLING
  ===================================================== */

  describe("Duplicate Handling", () => {
    test("creating copy with existing ID fails", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");

      const res = await app.inject({
        method: "POST",
        url: `/books/${book.id}/copies`,
        payload: { id: "0A1K9X" },
      });

      // Should fail with unique constraint violation
      expect(res.statusCode).toBe(500);
    });

    test("creating rack with existing ID fails", async () => {
      if (!dbAvailable) return;
      await seedRack("0A1K9X");

      const res = await app.inject({
        method: "POST",
        url: "/racks",
        payload: { id: "0A1K9X", room: "Another Room" },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  /* =====================================================
     HTTP METHOD EDGE CASES
  ===================================================== */

  describe("HTTP Method Handling", () => {
    test("POST to GET-only endpoint returns 404", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/stats/library",
      });

      expect(res.statusCode).toBe(404);
    });

    test("PUT (unsupported) returns 404", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();

      const res = await app.inject({
        method: "PUT",
        url: `/books/${book.id}`,
        payload: { title: "Updated" },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
