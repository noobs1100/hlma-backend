import { z } from "zod";

/* =====================================================
   Shared patterns
===================================================== */

const BASE32_REGEX = /^[0-9A-HJKMNP-TV-Z]{6}$/;
const COPY_STATES = ["available", "borrowed", "lost", "returned_pending"] as const;

export const base32Id = z.string().regex(BASE32_REGEX, "Must be a 6-character Crockford Base32 ID");
export const uuidParam = z.string().uuid();

/* =====================================================
   Pagination
===================================================== */

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

/* =====================================================
   Books
===================================================== */

export const createBookBody = z.object({
  title: z.string().min(1).max(500),
  author: z.string().max(500).optional(),
  isbn: z.string().max(20).optional(),
  publishedYear: z.number().int().min(0).max(9999).optional(),
  description: z.string().max(5000).optional(),
});

export const updateBookBody = createBookBody.partial();

export const bookIdParam = z.object({
  bookId: uuidParam,
});

/* =====================================================
   Racks
===================================================== */

export const createRackBody = z.object({
  id: base32Id,
  room: z.string().min(1).max(200),
  cupboard: z.string().max(200).optional(),
  rackNumber: z.string().max(50).optional(),
  description: z.string().max(2000).optional(),
});

export const updateRackBody = z.object({
  room: z.string().min(1).max(200).optional(),
  cupboard: z.string().max(200).optional(),
  rackNumber: z.string().max(50).optional(),
  description: z.string().max(2000).optional(),
});

export const rackIdParam = z.object({
  rackId: base32Id,
});

/* =====================================================
   Book Copies
===================================================== */

export const createCopyBody = z.object({
  id: base32Id,
  rackId: base32Id.optional(),
});

export const updateCopyBody = z.object({
  rackId: base32Id.nullable().optional(),
});

export const updateCopyStateBody = z.object({
  state: z.enum(COPY_STATES),
});

export const copyIdParam = z.object({
  copyId: base32Id,
});

/* =====================================================
   Borrowing
===================================================== */

export const borrowBody = z.object({
  userId: z.string().min(1).optional(), // defaults to current user
});

export const transferBody = z.object({
  toUserId: z.string().min(1),
});

export const userIdParam = z.object({
  userId: z.string().min(1),
});

export const borrowIdParam = z.object({
  borrowId: uuidParam,
});

/* =====================================================
   Rack placement
===================================================== */

export const placeBookBody = z.object({
  copyId: base32Id,
});

/* =====================================================
   Lazy Registration
===================================================== */

export const registerCopyBody = z.object({
  id: base32Id,
  bookId: uuidParam,
  rackId: base32Id.optional(),
});

export const registerRackBody = z.object({
  id: base32Id,
  room: z.string().min(1).max(200),
  cupboard: z.string().max(200).optional(),
  rackNumber: z.string().max(50).optional(),
  description: z.string().max(2000).optional(),
});

/* =====================================================
   Audit
===================================================== */

export const auditScanBody = z.object({
  copyId: base32Id,
});

/* =====================================================
   Types
===================================================== */

export type PaginationQuery = z.infer<typeof paginationQuery>;
export type CopyState = (typeof COPY_STATES)[number];
