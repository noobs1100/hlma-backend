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
   Rack Routes Tests
===================================================== */

describe("Rack Routes", () => {
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

  /* ----- POST /racks ----- */

  describe("POST /racks", () => {
    test("creates a rack with valid data", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/racks",
        payload: {
          id: "0A1K9X",
          room: "Room A",
          cupboard: "Cupboard 1",
          rackNumber: "R01",
          description: "Fiction section",
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().id).toBe("0A1K9X");
      expect(res.json().room).toBe("Room A");
    });

    test("creates a rack with only required fields", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/racks",
        payload: { id: "0A1K9X", room: "Room B" },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().cupboard).toBeNull();
    });

    test("rejects invalid Base32 ID", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/racks",
        payload: { id: "ILOU01", room: "Room" }, // I, L, O, U are excluded in Crockford
      });

      expect(res.statusCode).toBe(400);
    });

    test("rejects short ID", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/racks",
        payload: { id: "0A1", room: "Room" },
      });

      expect(res.statusCode).toBe(400);
    });

    test("rejects missing room", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/racks",
        payload: { id: "0A1K9X" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  /* ----- GET /racks ----- */

  describe("GET /racks", () => {
    test("returns paginated racks", async () => {
      if (!dbAvailable) return;
      await seedRack("0A1K9X", { room: "Room A" });
      await seedRack("9F3T8M", { room: "Room B" });

      const res = await app.inject({ method: "GET", url: "/racks" });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBe(2);
      expect(res.json().pagination.total).toBe(2);
    });

    test("returns empty when no racks", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({ method: "GET", url: "/racks" });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([]);
    });
  });

  /* ----- GET /racks/:rackId ----- */

  describe("GET /racks/:rackId", () => {
    test("returns rack by id", async () => {
      if (!dbAvailable) return;
      await seedRack("0A1K9X", { room: "Room A" });

      const res = await app.inject({
        method: "GET",
        url: "/racks/0A1K9X",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().room).toBe("Room A");
    });

    test("returns 404 for non-existent rack", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: "/racks/ZZZZZZ",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  /* ----- PATCH /racks/:rackId ----- */

  describe("PATCH /racks/:rackId", () => {
    test("updates rack metadata", async () => {
      if (!dbAvailable) return;
      await seedRack("0A1K9X", { room: "Old Room" });

      const res = await app.inject({
        method: "PATCH",
        url: "/racks/0A1K9X",
        payload: { room: "New Room", description: "Updated" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().room).toBe("New Room");
      expect(res.json().description).toBe("Updated");
    });

    test("returns 404 for non-existent rack", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "PATCH",
        url: "/racks/ZZZZZZ",
        payload: { room: "Room" },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  /* ----- DELETE /racks/:rackId ----- */

  describe("DELETE /racks/:rackId", () => {
    test("deletes a rack and nullifies copy references", async () => {
      if (!dbAvailable) return;
      const rack = await seedRack("0A1K9X");
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M", { rackId: "0A1K9X" });

      const res = await app.inject({
        method: "DELETE",
        url: "/racks/0A1K9X",
      });

      expect(res.statusCode).toBe(204);

      // Verify copy still exists but rack is null
      const copyRes = await app.inject({
        method: "GET",
        url: "/copies/9F3T8M",
      });
      expect(copyRes.json().rackId).toBeNull();
    });

    test("returns 404 for non-existent rack", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "DELETE",
        url: "/racks/ZZZZZZ",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  /* ----- GET /racks/:rackId/books ----- */

  describe("GET /racks/:rackId/books", () => {
    test("lists copies in a rack with book info", async () => {
      if (!dbAvailable) return;
      const rack = await seedRack("0A1K9X");
      const book = await seedBook({ title: "Shelf Book" });
      await seedCopy(book.id, "9F3T8M", { rackId: "0A1K9X" });

      const res = await app.inject({
        method: "GET",
        url: "/racks/0A1K9X/books",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(1);
      expect(res.json()[0].book.title).toBe("Shelf Book");
    });

    test("returns 404 for non-existent rack", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: "/racks/ZZZZZZ/books",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  /* ----- POST /racks/:rackId/place ----- */

  describe("POST /racks/:rackId/place", () => {
    test("places a returned_pending book into rack", async () => {
      if (!dbAvailable) return;
      await seedRack("0A1K9X");
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M", { state: "returned_pending" });

      const res = await app.inject({
        method: "POST",
        url: "/racks/0A1K9X/place",
        payload: { copyId: "9F3T8M" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().rackId).toBe("0A1K9X");
      expect(res.json().state).toBe("available");
    });

    test("places an available book into a new rack", async () => {
      if (!dbAvailable) return;
      await seedRack("0A1K9X");
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M", { state: "available" });

      const res = await app.inject({
        method: "POST",
        url: "/racks/0A1K9X/place",
        payload: { copyId: "9F3T8M" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe("available");
    });

    test("cannot place a borrowed book into rack", async () => {
      if (!dbAvailable) return;
      await seedRack("0A1K9X");
      const book = await seedBook();
      await seedCopy(book.id, "9F3T8M", { state: "borrowed" });

      const res = await app.inject({
        method: "POST",
        url: "/racks/0A1K9X/place",
        payload: { copyId: "9F3T8M" },
      });

      expect(res.statusCode).toBe(409);
    });
  });

  /* ----- Audit flow ----- */

  describe("Audit flow", () => {
    test("complete audit: start → scan → result", async () => {
      if (!dbAvailable) return;
      const rack = await seedRack("0A1K9X");
      const book1 = await seedBook({ title: "Expected Book" });
      const book2 = await seedBook({ title: "Missing Book" });
      await seedCopy(book1.id, "9F3T8M", { rackId: "0A1K9X" });
      await seedCopy(book2.id, "1Z7QKP", { rackId: "0A1K9X" });

      // Start audit
      const startRes = await app.inject({
        method: "POST",
        url: "/racks/0A1K9X/audit/start",
      });
      expect(startRes.statusCode).toBe(201);
      expect(startRes.json().message).toContain("started");

      // Scan only one book (the other will be "missing")
      const scanRes = await app.inject({
        method: "POST",
        url: "/racks/0A1K9X/audit/scan",
        payload: { copyId: "9F3T8M" },
      });
      expect(scanRes.statusCode).toBe(200);
      expect(scanRes.json().scannedCount).toBe(1);

      // Scan a misplaced book (not assigned to this rack)
      const book3 = await seedBook({ title: "Misplaced" });
      await seedCopy(book3.id, "2X4Y6Z"); // no rack
      const scanRes2 = await app.inject({
        method: "POST",
        url: "/racks/0A1K9X/audit/scan",
        payload: { copyId: "2X4Y6Z" },
      });
      expect(scanRes2.json().scannedCount).toBe(2);

      // Get result
      const resultRes = await app.inject({
        method: "GET",
        url: "/racks/0A1K9X/audit/result",
      });
      expect(resultRes.statusCode).toBe(200);
      const result = resultRes.json();
      expect(result.expected).toBe(2);
      expect(result.scanned).toBe(2);
      expect(result.found).toBe(1);
      expect(result.missing.length).toBe(1);
      expect(result.missing[0].copyId).toBe("1Z7QKP");
      expect(result.misplaced.length).toBe(1);
      expect(result.misplaced[0]).toBe("2X4Y6Z");
    });

    test("returns 404 when no audit session active", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "GET",
        url: "/racks/0A1K9X/audit/result",
      });

      expect(res.statusCode).toBe(404);
    });

    test("returns 404 for non-existent rack audit start", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/racks/ZZZZZZ/audit/start",
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
