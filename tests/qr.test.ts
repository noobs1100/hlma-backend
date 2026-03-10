import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  cleanDatabase,
  seedUsers,
  seedBook,
  TEST_USER,
  skipIfNoDb,
} from "./setup";
import { db } from "../src/db";
import { qrLabels } from "../src/db/schema";
import { eq, sql } from "drizzle-orm";

/* =====================================================
   QR Routes Tests
===================================================== */

describe("QR Routes", () => {
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

  /* ----- GET /qr/:type/info ----- */

  describe("GET /qr/:type/info", () => {
    test("returns label metadata for books", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/qr/book/info?count=140",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalLabels).toBe(140);
      expect(body.labelsPerPage).toBe(140);
      expect(body.totalPages).toBe(1);
    });

    test("returns label metadata for racks", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/qr/rack/info?count=40",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalLabels).toBe(40);
      expect(body.labelsPerPage).toBe(20);
      expect(body.totalPages).toBe(2);
    });

    test("uses default count when not specified", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/qr/book/info",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalLabels).toBe(140); // default
    });

    test("rejects invalid type", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/qr/invalid/info",
      });

      expect(res.statusCode).toBe(400);
    });
  });

  /* ----- POST /qr/:type/batch ----- */

  describe("POST /qr/:type/batch", () => {
    test("generates PDF for book labels", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/qr/book/batch",
        payload: { count: 10 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("application/pdf");
      expect(res.headers["x-labels-count"]).toBe("10");
      expect(res.headers["x-labels-per-page"]).toBe("140");
      expect(res.headers["x-pages-count"]).toBe("1");
      expect(res.headers["x-batch-id"]).toBeDefined();
    });

    test("generates PDF for rack labels", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/qr/rack/batch",
        payload: { count: 20 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("application/pdf");
      expect(res.headers["x-labels-count"]).toBe("20");
      expect(res.headers["x-batch-id"]).toBeDefined();
    });

    test("persists generated IDs in qr_labels table", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/qr/book/batch",
        payload: { count: 5 },
      });

      expect(res.statusCode).toBe(200);
      const batchId = res.headers["x-batch-id"] as string;

      // Verify IDs were persisted
      const rows = await db
        .select()
        .from(qrLabels)
        .where(eq(qrLabels.batchId, batchId));

      expect(rows.length).toBe(5);
      expect(rows.every((r) => r.type === "book")).toBe(true);
    });

    test("generates multiple pages when needed", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/qr/book/batch",
        payload: { count: 150 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-pages-count"]).toBe("2");
    });

    test("rejects count less than 1", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/qr/book/batch",
        payload: { count: 0 },
      });

      expect(res.statusCode).toBe(400);
    });

    test("rejects count greater than 1000", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/qr/book/batch",
        payload: { count: 1001 },
      });

      expect(res.statusCode).toBe(400);
    });

    test("rejects invalid type", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/qr/invalid/batch",
        payload: { count: 10 },
      });

      expect(res.statusCode).toBe(400);
    });

    test("rejects missing count", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/qr/book/batch",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    test("two batch calls never produce overlapping IDs", async () => {
      if (!dbAvailable) return;

      // Generate two batches
      const res1 = await app.inject({
        method: "POST",
        url: "/qr/book/batch",
        payload: { count: 50 },
      });
      const res2 = await app.inject({
        method: "POST",
        url: "/qr/book/batch",
        payload: { count: 50 },
      });

      expect(res1.statusCode).toBe(200);
      expect(res2.statusCode).toBe(200);

      const batch1Id = res1.headers["x-batch-id"] as string;
      const batch2Id = res2.headers["x-batch-id"] as string;
      expect(batch1Id).not.toBe(batch2Id);

      // Fetch all IDs from both batches
      const rows1 = await db
        .select({ id: qrLabels.id })
        .from(qrLabels)
        .where(eq(qrLabels.batchId, batch1Id));
      const rows2 = await db
        .select({ id: qrLabels.id })
        .from(qrLabels)
        .where(eq(qrLabels.batchId, batch2Id));

      expect(rows1.length).toBe(50);
      expect(rows2.length).toBe(50);

      // Check zero overlap
      const set1 = new Set(rows1.map((r) => r.id));
      const overlap = rows2.filter((r) => set1.has(r.id));
      expect(overlap.length).toBe(0);
    });

    test("book and rack IDs are independent namespaces", async () => {
      if (!dbAvailable) return;

      // It's fine for a book and rack to share the same 6-char ID
      // because the type column differentiates them
      const res1 = await app.inject({
        method: "POST",
        url: "/qr/book/batch",
        payload: { count: 10 },
      });
      const res2 = await app.inject({
        method: "POST",
        url: "/qr/rack/batch",
        payload: { count: 10 },
      });

      expect(res1.statusCode).toBe(200);
      expect(res2.statusCode).toBe(200);

      // Both should succeed — the composite PK is (type, id)
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(qrLabels);
      expect(countResult.count).toBe(20);
    });
  });

  /* ----- POST /qr/:type/reprint ----- */

  describe("POST /qr/:type/reprint", () => {
    test("reprints labels for previously generated IDs", async () => {
      if (!dbAvailable) return;

      // First, generate a batch to get some IDs
      const batchRes = await app.inject({
        method: "POST",
        url: "/qr/book/batch",
        payload: { count: 3 },
      });
      expect(batchRes.statusCode).toBe(200);
      const batchId = batchRes.headers["x-batch-id"] as string;

      // Get the IDs that were generated
      const rows = await db
        .select({ id: qrLabels.id })
        .from(qrLabels)
        .where(eq(qrLabels.batchId, batchId));
      const ids = rows.map((r) => r.id);
      expect(ids.length).toBe(3);

      // Reprint those IDs
      const res = await app.inject({
        method: "POST",
        url: "/qr/book/reprint",
        payload: { ids },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("application/pdf");
      expect(res.headers["x-labels-count"]).toBe("3");
    });

    test("reprints labels for manually registered copies", async () => {
      if (!dbAvailable) return;

      // Create a book and a copy directly (not via QR batch)
      const bookRes = await app.inject({
        method: "POST",
        url: "/books",
        payload: { title: "Manual Book" },
      });
      const book = bookRes.json();

      await app.inject({
        method: "POST",
        url: "/copies/register",
        payload: { id: "MANB4R", bookId: book.id },
      });

      // Reprint — ID exists in book_copies but not in qr_labels
      const res = await app.inject({
        method: "POST",
        url: "/qr/book/reprint",
        payload: { ids: ["MANB4R"] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("application/pdf");
    });

    test("rejects unknown IDs", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/qr/book/reprint",
        payload: { ids: ["ZZZZZZ"] },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.unknownIds).toContain("ZZZZZZ");
    });

    test("rejects mix of known and unknown IDs", async () => {
      if (!dbAvailable) return;

      // Generate one real ID
      const batchRes = await app.inject({
        method: "POST",
        url: "/qr/book/batch",
        payload: { count: 1 },
      });
      const batchId = batchRes.headers["x-batch-id"] as string;
      const [row] = await db
        .select({ id: qrLabels.id })
        .from(qrLabels)
        .where(eq(qrLabels.batchId, batchId));

      // Mix with a valid-format ID that doesn't exist
      const res = await app.inject({
        method: "POST",
        url: "/qr/book/reprint",
        payload: { ids: [row.id, "999ZZZ"] },
      });

      // Should reject — partial reprints would be confusing
      expect(res.statusCode).toBe(404);
      expect(res.json().unknownIds).toContain("999ZZZ");
      expect(res.json().unknownIds).not.toContain(row.id);
    });

    test("rejects invalid Base32 format", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/qr/book/reprint",
        payload: { ids: ["bad!id"] },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().invalidIds).toContain("bad!id");
    });

    test("deduplicates repeated IDs", async () => {
      if (!dbAvailable) return;

      // Generate one ID
      const batchRes = await app.inject({
        method: "POST",
        url: "/qr/book/batch",
        payload: { count: 1 },
      });
      const batchId = batchRes.headers["x-batch-id"] as string;
      const [row] = await db
        .select({ id: qrLabels.id })
        .from(qrLabels)
        .where(eq(qrLabels.batchId, batchId));

      // Request same ID twice
      const res = await app.inject({
        method: "POST",
        url: "/qr/book/reprint",
        payload: { ids: [row.id, row.id, row.id] },
      });

      expect(res.statusCode).toBe(200);
      // Should only produce 1 label, not 3
      expect(res.headers["x-labels-count"]).toBe("1");
    });

    test("rejects empty ids array", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/qr/book/reprint",
        payload: { ids: [] },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});

/* =====================================================
   Lazy Registration Tests
===================================================== */

describe("Lazy Registration", () => {
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

  /* ----- POST /copies/register ----- */

  describe("POST /copies/register", () => {
    test("registers a new copy with valid QR ID", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "Book to Register" });

      const res = await app.inject({
        method: "POST",
        url: "/copies/register",
        payload: {
          id: "ABC123",
          bookId: book.id,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBe("ABC123");
      expect(body.bookId).toBe(book.id);
      expect(body.state).toBe("available");
    });

    test("registers copy with optional rack", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();

      // First create a rack
      await app.inject({
        method: "POST",
        url: "/racks",
        payload: {
          id: "RACK01",
          room: "Library",
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/copies/register",
        payload: {
          id: "XYZ789",
          bookId: book.id,
          rackId: "RACK01",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.rackId).toBe("RACK01");
    });

    test("rejects duplicate registration", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();

      // First registration
      await app.inject({
        method: "POST",
        url: "/copies/register",
        payload: {
          id: "ABC123",
          bookId: book.id,
        },
      });

      // Second registration with same ID
      const res = await app.inject({
        method: "POST",
        url: "/copies/register",
        payload: {
          id: "ABC123",
          bookId: book.id,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain("already registered");
    });

    test("rejects registration with non-existent book", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "POST",
        url: "/copies/register",
        payload: {
          id: "ABC123",
          bookId: "00000000-0000-0000-0000-000000000000",
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Book not found");
    });

    test("rejects invalid Base32 ID", async () => {
      if (!dbAvailable) return;
      const book = await seedBook();

      const res = await app.inject({
        method: "POST",
        url: "/copies/register",
        payload: {
          id: "invalid!", // Contains invalid characters
          bookId: book.id,
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  /* ----- Scan -> Register Flow ----- */

  describe("Full Scan -> Register Flow", () => {
    test("scan shows unregistered, then register makes it available", async () => {
      if (!dbAvailable) return;
      const book = await seedBook({ title: "Lazy Book" });

      // Step 1: Scan unregistered QR
      const scanRes = await app.inject({
        method: "GET",
        url: "/scan/book/8F2K1M",
      });

      expect(scanRes.statusCode).toBe(200);
      expect(scanRes.json().status).toBe("unregistered");
      expect(scanRes.json().id).toBe("8F2K1M");

      // Step 2: Register the copy
      const registerRes = await app.inject({
        method: "POST",
        url: "/copies/register",
        payload: {
          id: "8F2K1M",
          bookId: book.id,
        },
      });

      expect(registerRes.statusCode).toBe(201);

      // Step 3: Scan again - now it should show the book
      const scanRes2 = await app.inject({
        method: "GET",
        url: "/scan/book/8F2K1M",
      });

      expect(scanRes2.statusCode).toBe(200);
      const body = scanRes2.json();
      expect(body.status).toBeUndefined(); // Not unregistered anymore
      expect(body.copyId).toBe("8F2K1M");
      expect(body.state).toBe("available");
      expect(body.book.title).toBe("Lazy Book");
    });

    test("public scan also shows unregistered status", async () => {
      if (!dbAvailable) return;

      const res = await app.inject({
        method: "GET",
        url: "/public/book/9X7W3Q",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("unregistered");
    });
  });
});
