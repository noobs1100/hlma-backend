import { describe, test, expect } from "bun:test";
import {
  createBookBody,
  updateBookBody,
  createRackBody,
  createCopyBody,
  updateCopyStateBody,
  base32Id,
  paginationQuery,
  transferBody,
  borrowBody,
  copyIdParam,
  bookIdParam,
  rackIdParam,
  borrowIdParam,
  userIdParam,
} from "../src/schemas/validators";

/* =====================================================
   Zod Validator Tests
===================================================== */

describe("Validators", () => {
  /* ----- Base32 ID ----- */

  describe("base32Id", () => {
    test("accepts valid Crockford Base32 IDs", () => {
      expect(base32Id.parse("0A1K9X")).toBe("0A1K9X");
      expect(base32Id.parse("9F3T8M")).toBe("9F3T8M");
      expect(base32Id.parse("1Z7QKP")).toBe("1Z7QKP");
      expect(base32Id.parse("000000")).toBe("000000");
      expect(base32Id.parse("ZZZZZZ")).toBe("ZZZZZZ");
    });

    test("rejects lowercase", () => {
      expect(() => base32Id.parse("0a1k9x")).toThrow();
    });

    test("rejects excluded characters (I, L, O, U)", () => {
      expect(() => base32Id.parse("ILOU01")).toThrow();
      expect(() => base32Id.parse("I00000")).toThrow();
      expect(() => base32Id.parse("L00000")).toThrow();
      expect(() => base32Id.parse("O00000")).toThrow();
      expect(() => base32Id.parse("U00000")).toThrow();
    });

    test("rejects wrong length", () => {
      expect(() => base32Id.parse("0A1")).toThrow();
      expect(() => base32Id.parse("0A1K9X0")).toThrow();
      expect(() => base32Id.parse("")).toThrow();
    });

    test("rejects special characters", () => {
      expect(() => base32Id.parse("0A-K9X")).toThrow();
      expect(() => base32Id.parse("0A K9X")).toThrow();
    });
  });

  /* ----- Pagination ----- */

  describe("paginationQuery", () => {
    test("uses defaults when empty", () => {
      const result = paginationQuery.parse({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.search).toBeUndefined();
    });

    test("coerces string numbers", () => {
      const result = paginationQuery.parse({ page: "3", limit: "50" });
      expect(result.page).toBe(3);
      expect(result.limit).toBe(50);
    });

    test("rejects page < 1", () => {
      expect(() => paginationQuery.parse({ page: 0 })).toThrow();
    });

    test("rejects limit > 100", () => {
      expect(() => paginationQuery.parse({ limit: 101 })).toThrow();
    });

    test("accepts search string", () => {
      const result = paginationQuery.parse({ search: "javascript" });
      expect(result.search).toBe("javascript");
    });
  });

  /* ----- createBookBody ----- */

  describe("createBookBody", () => {
    test("accepts valid book", () => {
      const result = createBookBody.parse({
        title: "Test Book",
        author: "Author",
        isbn: "978-1234567890",
        publishedYear: 2023,
        description: "A great book",
      });
      expect(result.title).toBe("Test Book");
    });

    test("requires title", () => {
      expect(() => createBookBody.parse({})).toThrow();
    });

    test("rejects empty title", () => {
      expect(() => createBookBody.parse({ title: "" })).toThrow();
    });

    test("optional fields can be omitted", () => {
      const result = createBookBody.parse({ title: "Minimal" });
      expect(result.author).toBeUndefined();
    });

    test("rejects invalid publishedYear", () => {
      expect(() => createBookBody.parse({ title: "X", publishedYear: -1 })).toThrow();
      expect(() => createBookBody.parse({ title: "X", publishedYear: 10000 })).toThrow();
    });
  });

  /* ----- updateBookBody ----- */

  describe("updateBookBody", () => {
    test("all fields are optional", () => {
      const result = updateBookBody.parse({});
      expect(result).toEqual({});
    });

    test("accepts partial updates", () => {
      const result = updateBookBody.parse({ title: "New Title" });
      expect(result.title).toBe("New Title");
    });
  });

  /* ----- createRackBody ----- */

  describe("createRackBody", () => {
    test("accepts valid rack", () => {
      const result = createRackBody.parse({
        id: "0A1K9X",
        room: "Room A",
        cupboard: "C1",
        rackNumber: "R1",
      });
      expect(result.id).toBe("0A1K9X");
    });

    test("requires id and room", () => {
      expect(() => createRackBody.parse({ id: "0A1K9X" })).toThrow();
      expect(() => createRackBody.parse({ room: "Room" })).toThrow();
    });

    test("rejects invalid Base32 rack id", () => {
      expect(() => createRackBody.parse({ id: "invalid", room: "Room" })).toThrow();
    });
  });

  /* ----- createCopyBody ----- */

  describe("createCopyBody", () => {
    test("accepts valid copy", () => {
      const result = createCopyBody.parse({ id: "9F3T8M" });
      expect(result.id).toBe("9F3T8M");
    });

    test("accepts copy with rackId", () => {
      const result = createCopyBody.parse({ id: "9F3T8M", rackId: "0A1K9X" });
      expect(result.rackId).toBe("0A1K9X");
    });

    test("rejects invalid copy id", () => {
      expect(() => createCopyBody.parse({ id: "bad" })).toThrow();
    });
  });

  /* ----- updateCopyStateBody ----- */

  describe("updateCopyStateBody", () => {
    test("accepts all valid states", () => {
      expect(updateCopyStateBody.parse({ state: "available" }).state).toBe("available");
      expect(updateCopyStateBody.parse({ state: "borrowed" }).state).toBe("borrowed");
      expect(updateCopyStateBody.parse({ state: "lost" }).state).toBe("lost");
      expect(updateCopyStateBody.parse({ state: "returned_pending" }).state).toBe("returned_pending");
    });

    test("rejects invalid state", () => {
      expect(() => updateCopyStateBody.parse({ state: "destroyed" })).toThrow();
      expect(() => updateCopyStateBody.parse({ state: "" })).toThrow();
    });
  });

  /* ----- Param validators ----- */

  describe("Param validators", () => {
    test("copyIdParam validates Base32", () => {
      expect(copyIdParam.parse({ copyId: "0A1K9X" }).copyId).toBe("0A1K9X");
      expect(() => copyIdParam.parse({ copyId: "bad" })).toThrow();
    });

    test("rackIdParam validates Base32", () => {
      expect(rackIdParam.parse({ rackId: "0A1K9X" }).rackId).toBe("0A1K9X");
      expect(() => rackIdParam.parse({ rackId: "bad" })).toThrow();
    });

    test("bookIdParam validates UUID", () => {
      expect(
        bookIdParam.parse({ bookId: "00000000-0000-0000-0000-000000000000" }).bookId
      ).toBe("00000000-0000-0000-0000-000000000000");
      expect(() => bookIdParam.parse({ bookId: "not-uuid" })).toThrow();
    });

    test("borrowIdParam validates UUID", () => {
      expect(
        borrowIdParam.parse({ borrowId: "00000000-0000-0000-0000-000000000000" }).borrowId
      ).toBe("00000000-0000-0000-0000-000000000000");
      expect(() => borrowIdParam.parse({ borrowId: "bad" })).toThrow();
    });

    test("userIdParam validates non-empty string", () => {
      expect(userIdParam.parse({ userId: "user-1" }).userId).toBe("user-1");
      expect(() => userIdParam.parse({ userId: "" })).toThrow();
    });
  });

  /* ----- transferBody ----- */

  describe("transferBody", () => {
    test("requires toUserId", () => {
      expect(transferBody.parse({ toUserId: "user-2" }).toUserId).toBe("user-2");
      expect(() => transferBody.parse({})).toThrow();
    });

    test("rejects empty toUserId", () => {
      expect(() => transferBody.parse({ toUserId: "" })).toThrow();
    });
  });

  /* ----- borrowBody ----- */

  describe("borrowBody", () => {
    test("userId is optional", () => {
      const result = borrowBody.parse({});
      expect(result.userId).toBeUndefined();
    });

    test("accepts userId", () => {
      const result = borrowBody.parse({ userId: "user-1" });
      expect(result.userId).toBe("user-1");
    });
  });
});
