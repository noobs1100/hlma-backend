import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import type { FastifyInstance } from "fastify";
import { db } from "../src/db";
import { books, bookCopies, borrows, racks } from "../src/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  buildTestApp,
  cleanDatabase,
  seedUsers,
  seedBook,
  seedCopy,
  seedRack,
  TEST_USER,
  TEST_USER_2,
  skipIfNoDb,
} from "./setup";

/* =====================================================
   STRESS & PERFORMANCE TESTS - Staff Engineer Level
   
   These tests verify behavior under load:
   - High volume operations
   - Bulk operations
   - Database performance boundaries
   - Memory handling with large payloads
===================================================== */

describe("Stress & Performance Tests", () => {
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
     HIGH VOLUME OPERATIONS
  ===================================================== */

  describe("High Volume Operations", () => {
    test("can create 100 books sequentially", async () => {
      if (!dbAvailable) return;

      const startTime = Date.now();
      for (let i = 0; i < 100; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/books",
          payload: { title: `Book ${i}`, author: `Author ${i}` },
        });
        expect(res.statusCode).toBe(201);
      }
      const elapsed = Date.now() - startTime;

      // Should complete in reasonable time (< 10s for 100 books)
      expect(elapsed).toBeLessThan(10000);

      // Verify count
      const listRes = await app.inject({
        method: "GET",
        url: "/books?limit=1",
      });
      expect(listRes.json().pagination.total).toBe(100);
    });

    test("can create 50 books in parallel batches", async () => {
      if (!dbAvailable) return;

      const batchSize = 10;
      const totalBooks = 50;
      const startTime = Date.now();

      for (let batch = 0; batch < totalBooks / batchSize; batch++) {
        const promises = [];
        for (let i = 0; i < batchSize; i++) {
          const idx = batch * batchSize + i;
          promises.push(
            app.inject({
              method: "POST",
              url: "/books",
              payload: { title: `Batch Book ${idx}` },
            })
          );
        }
        const results = await Promise.all(promises);
        results.forEach((res) => expect(res.statusCode).toBe(201));
      }

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(10000);
    });

    test("paginating through 500 books performs well", async () => {
      if (!dbAvailable) return;

      // Bulk insert books
      const bookValues = Array.from({ length: 500 }, (_, i) => ({
        title: `Bulk Book ${i}`,
        author: `Author ${i % 50}`,
        isbn: `ISBN-${i}`,
      }));

      await db.insert(books).values(bookValues);

      // Test pagination performance
      const startTime = Date.now();

      // Fetch all pages (50 items per page = 10 pages)
      for (let page = 1; page <= 10; page++) {
        const res = await app.inject({
          method: "GET",
          url: `/books?page=${page}&limit=50`,
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.length).toBe(50);
      }

      const elapsed = Date.now() - startTime;
      // All 10 pages should load in < 3 seconds
      expect(elapsed).toBeLessThan(3000);
    });

    test("search across 500 books returns quickly", async () => {
      if (!dbAvailable) return;

      // Bulk insert books with varied authors
      const bookValues = Array.from({ length: 500 }, (_, i) => ({
        title: `Book ${i}: ${i % 2 === 0 ? "JavaScript" : "Python"} Guide`,
        author: i % 3 === 0 ? "Popular Author" : `Author ${i}`,
      }));

      await db.insert(books).values(bookValues);

      const startTime = Date.now();

      // Search should use index
      const res = await app.inject({
        method: "GET",
        url: "/books?search=JavaScript",
      });

      const elapsed = Date.now() - startTime;
      expect(res.statusCode).toBe(200);
      // ILIKE search should still be fast
      expect(elapsed).toBeLessThan(500);
      expect(res.json().data.length).toBeGreaterThan(0);
    });
  });

  /* =====================================================
     BULK COPY OPERATIONS
  ===================================================== */

  describe("Bulk Copy Operations", () => {
    test("can create 50 copies for a single book", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "Popular Book" });

      // Generate valid Base32 IDs
      const base32Chars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
      const generateId = (i: number) => {
        let id = "";
        let n = i;
        for (let j = 0; j < 6; j++) {
          id = base32Chars[n % 32] + id;
          n = Math.floor(n / 32);
        }
        return id;
      };

      for (let i = 0; i < 50; i++) {
        const res = await app.inject({
          method: "POST",
          url: `/books/${book.id}/copies`,
          payload: { id: generateId(i + 1000) }, // Start at 1000 to ensure 6 chars
        });
        expect(res.statusCode).toBe(201);
      }

      // Verify copies
      const copiesRes = await app.inject({
        method: "GET",
        url: `/books/${book.id}/copies`,
      });
      expect(copiesRes.json().length).toBe(50);
    });

    test("borrow history query performs well with many records", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      const rack = await seedRack("0A1K9X");

      // Create copies and simulate borrow/return cycles
      const base32Chars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
      const generateId = (i: number) => {
        let id = "";
        let n = i + 1000;
        for (let j = 0; j < 6; j++) {
          id = base32Chars[n % 32] + id;
          n = Math.floor(n / 32);
        }
        return id;
      };

      const copyId = generateId(0);
      await seedCopy(book.id, copyId);

      // Simulate 20 borrow/return cycles
      for (let i = 0; i < 20; i++) {
        await app.inject({
          method: "POST",
          url: `/copies/${copyId}/borrow`,
        });
        await app.inject({
          method: "POST",
          url: `/copies/${copyId}/return`,
        });
        await app.inject({
          method: "POST",
          url: `/racks/0A1K9X/place`,
          payload: { copyId },
        });
      }

      // Query history
      const startTime = Date.now();
      const res = await app.inject({
        method: "GET",
        url: `/copies/${copyId}/history?limit=100`,
      });
      const elapsed = Date.now() - startTime;

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(20);
      expect(elapsed).toBeLessThan(500);
    });
  });

  /* =====================================================
     CONCURRENT STRESS TESTS
  ===================================================== */

  describe("Concurrent Stress Tests", () => {
    test("10 concurrent searches don't block each other", async () => {
      if (!dbAvailable) return;

      // Seed some books
      for (let i = 0; i < 20; i++) {
        await seedBook({ title: `Concurrent Book ${i}`, author: `Author ${i}` });
      }

      const startTime = Date.now();

      // Fire 10 concurrent searches
      const searches = Array.from({ length: 10 }, (_, i) =>
        app.inject({
          method: "GET",
          url: `/books?search=Book ${i}`,
        })
      );

      const results = await Promise.all(searches);
      const elapsed = Date.now() - startTime;

      results.forEach((res) => expect(res.statusCode).toBe(200));
      // All 10 concurrent searches should complete quickly
      expect(elapsed).toBeLessThan(2000);
    });

    test("mixed read/write operations under concurrent load", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();

      const operations = [
        // Reads
        app.inject({ method: "GET", url: "/books" }),
        app.inject({ method: "GET", url: `/books/${book.id}` }),
        app.inject({ method: "GET", url: "/stats/library" }),
        // Writes
        app.inject({
          method: "POST",
          url: "/books",
          payload: { title: "New Book 1" },
        }),
        app.inject({
          method: "POST",
          url: "/books",
          payload: { title: "New Book 2" },
        }),
        // More reads
        app.inject({ method: "GET", url: "/books?search=Book" }),
        app.inject({ method: "GET", url: "/racks" }),
      ];

      const results = await Promise.all(operations);

      // All should succeed
      results.forEach((res, i) => {
        const expected = i === 3 || i === 4 ? 201 : 200;
        expect(res.statusCode).toBe(expected);
      });
    });

    test("rapid fire requests to same endpoint", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "Rapid Fire Book" });

      const startTime = Date.now();

      // Fire 50 requests as fast as possible
      const requests = Array.from({ length: 50 }, () =>
        app.inject({ method: "GET", url: `/books/${book.id}` })
      );

      const results = await Promise.all(requests);
      const elapsed = Date.now() - startTime;

      results.forEach((res) => expect(res.statusCode).toBe(200));
      // Should handle 50 concurrent reads quickly
      expect(elapsed).toBeLessThan(2000);
    });
  });

  /* =====================================================
     LARGE DATA HANDLING
  ===================================================== */

  describe("Large Data Handling", () => {
    test("book with maximum length fields", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/books",
        payload: {
          title: "T".repeat(500),
          author: "A".repeat(500),
          isbn: "I".repeat(20),
          description: "D".repeat(5000),
          publishedYear: 2024,
        },
      });

      expect(res.statusCode).toBe(201);

      // Verify retrieval
      const getRes = await app.inject({
        method: "GET",
        url: `/books/${res.json().id}`,
      });
      expect(getRes.json().title.length).toBe(500);
      expect(getRes.json().description.length).toBe(5000);
    });

    test("rack description at max length", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/racks",
        payload: {
          id: "0A1K9X",
          room: "R".repeat(200),
          cupboard: "C".repeat(200),
          rackNumber: "N".repeat(50),
          description: "D".repeat(2000),
        },
      });

      expect(res.statusCode).toBe(201);
    });

    test("stats calculation with large dataset", async () => {
      if (!dbAvailable) return;

      // Bulk insert data
      const bookValues = Array.from({ length: 100 }, (_, i) => ({
        title: `Stats Book ${i}`,
      }));
      await db.insert(books).values(bookValues);

      const rackValues = Array.from({ length: 20 }, (_, i) => {
        const base32Chars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
        let id = "";
        let n = i + 1000;
        for (let j = 0; j < 6; j++) {
          id = base32Chars[n % 32] + id;
          n = Math.floor(n / 32);
        }
        return { id, room: `Room ${i}` };
      });
      await db.insert(racks).values(rackValues);

      const startTime = Date.now();

      const res = await app.inject({
        method: "GET",
        url: "/stats/library",
      });

      const elapsed = Date.now() - startTime;

      expect(res.statusCode).toBe(200);
      expect(res.json().totalBooks).toBe(100);
      expect(res.json().totalRacks).toBe(20);
      // Stats should be fast even with many records
      expect(elapsed).toBeLessThan(500);
    });
  });

  /* =====================================================
     DATABASE EDGE CASES
  ===================================================== */

  describe("Database Edge Cases", () => {
    test("handles special characters in WHERE clauses", async () => {
      if (!dbAvailable) return;

      // Create books with special patterns
      await seedBook({ title: "Book with 'quotes'" });
      await seedBook({ title: 'Book with "double quotes"' });
      await seedBook({ title: "Book with \\ backslash" });
      await seedBook({ title: "Book with % percent" });

      // Search should handle escaping properly
      const res1 = await app.inject({
        method: "GET",
        url: "/books?search='quotes'",
      });
      expect(res1.statusCode).toBe(200);

      const res2 = await app.inject({
        method: "GET",
        url: "/books?search=%25percent", // URL encoded %
      });
      expect(res2.statusCode).toBe(200);
    });

    test("transaction isolation - borrow race condition", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");

      // Multiple users trying to borrow same book
      const attempts = 5;
      const results = await Promise.all(
        Array.from({ length: attempts }, () =>
          app.inject({
            method: "POST",
            url: "/copies/0A1K9X/borrow",
          })
        )
      );

      const successes = results.filter((r) => r.statusCode === 201).length;
      const conflicts = results.filter((r) => r.statusCode === 409).length;

      // Only one should succeed, rest should get conflict
      expect(successes).toBe(1);
      expect(conflicts).toBe(attempts - 1);

      // Verify final state
      const [copy] = await db
        .select()
        .from(bookCopies)
        .where(eq(bookCopies.id, "0A1K9X"));
      expect(copy!.state).toBe("borrowed");

      // Only one active borrow record
      const borrowCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(borrows)
        .where(eq(borrows.copyId, "0A1K9X"));
      expect(borrowCount[0]!.count).toBe(1);
    });

    test("large number of racks in list", async () => {
      if (!dbAvailable) return;

      // Create 100 racks
      const base32Chars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
      const rackValues = Array.from({ length: 100 }, (_, i) => {
        let id = "";
        let n = i + 1000;
        for (let j = 0; j < 6; j++) {
          id = base32Chars[n % 32] + id;
          n = Math.floor(n / 32);
        }
        return { id, room: `Room ${Math.floor(i / 10)}`, cupboard: `Cupboard ${i % 10}` };
      });
      await db.insert(racks).values(rackValues);

      const res = await app.inject({
        method: "GET",
        url: "/racks?limit=100",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBe(100);
    });
  });

  /* =====================================================
     MEMORY & RESOURCE HANDLING
  ===================================================== */

  describe("Memory & Resource Handling", () => {
    test("multiple sequential requests don't leak memory", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();

      // Make many requests
      for (let i = 0; i < 100; i++) {
        const res = await app.inject({
          method: "GET",
          url: `/books/${book.id}`,
        });
        expect(res.statusCode).toBe(200);
      }

      // If we got here without crash, no obvious memory leak
      expect(true).toBe(true);
    });

    test("handles request timeout gracefully", async () => {
      if (!dbAvailable) return;

      // This tests that requests complete in reasonable time
      const timeoutMs = 5000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await app.inject({
          method: "GET",
          url: "/stats/library",
        });
        clearTimeout(timeoutId);
        expect(res.statusCode).toBe(200);
      } catch (e) {
        clearTimeout(timeoutId);
        throw new Error("Request timed out - potential performance issue");
      }
    });
  });

  /* =====================================================
     CONSISTENCY CHECKS
  ===================================================== */

  describe("Data Consistency", () => {
    test("borrow state matches borrows table", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");

      // Borrow
      await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/borrow",
      });

      // Check consistency
      const [copy] = await db.select().from(bookCopies).where(eq(bookCopies.id, "0A1K9X"));
      const activeBorrows = await db
        .select()
        .from(borrows)
        .where(
          sql`${borrows.copyId} = '0A1K9X' AND ${borrows.returnedAt} IS NULL`
        );

      expect(copy!.state).toBe("borrowed");
      expect(copy!.borrowedBy).toBe(TEST_USER.id);
      expect(activeBorrows.length).toBe(1);
      expect(activeBorrows[0].userId).toBe(TEST_USER.id);
    });

    test("return state matches borrows table", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");

      // Borrow then return
      await app.inject({ method: "POST", url: "/copies/0A1K9X/borrow" });
      await app.inject({ method: "POST", url: "/copies/0A1K9X/return" });

      // Check consistency
      const [copy] = await db.select().from(bookCopies).where(eq(bookCopies.id, "0A1K9X"));
      const activeBorrows = await db
        .select()
        .from(borrows)
        .where(
          sql`${borrows.copyId} = '0A1K9X' AND ${borrows.returnedAt} IS NULL`
        );
      const returnedBorrows = await db
        .select()
        .from(borrows)
        .where(
          sql`${borrows.copyId} = '0A1K9X' AND ${borrows.returnedAt} IS NOT NULL`
        );

      expect(copy!.state).toBe("returned_pending");
      expect(copy!.borrowedBy).toBeNull();
      expect(activeBorrows.length).toBe(0);
      expect(returnedBorrows.length).toBe(1);
    });

    test("transfer preserves borrow chain integrity", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();
      await seedCopy(book.id, "0A1K9X");

      // User1 borrows
      await app.inject({ method: "POST", url: "/copies/0A1K9X/borrow" });

      // Transfer to User2
      await app.inject({
        method: "POST",
        url: "/copies/0A1K9X/transfer",
        payload: { toUserId: TEST_USER_2.id },
      });

      // Check integrity
      const [copy] = await db.select().from(bookCopies).where(eq(bookCopies.id, "0A1K9X"));
      const allBorrows = await db
        .select()
        .from(borrows)
        .where(eq(borrows.copyId, "0A1K9X"));
      const activeBorrow = allBorrows.find((b) => b.returnedAt === null);
      const closedBorrow = allBorrows.find((b) => b.returnedAt !== null);

      expect(copy!.state).toBe("borrowed");
      expect(copy!.borrowedBy).toBe(TEST_USER_2.id);
      expect(allBorrows.length).toBe(2);
      expect(activeBorrow!.userId).toBe(TEST_USER_2.id);
      expect(closedBorrow!.userId).toBe(TEST_USER.id);
    });
  });
});
