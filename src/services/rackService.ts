import { db } from "../db";
import { bookCopies, racks, books } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { AppError } from "./borrowService";

/* =====================================================
   Place a returned book into a rack
===================================================== */

export async function placeBookInRack(rackId: string, copyId: string) {
  return await db.transaction(async (tx) => {
    // Verify rack exists
    const [rack] = await tx.select().from(racks).where(eq(racks.id, rackId));
    if (!rack) throw new AppError(404, "Rack not found");

    // Verify copy exists
    const [copy] = await tx
      .select()
      .from(bookCopies)
      .where(eq(bookCopies.id, copyId))
      .for("update");

    if (!copy) throw new AppError(404, "Book copy not found");
    if (copy.state !== "returned_pending" && copy.state !== "available") {
      throw new AppError(409, `Cannot place book in rack (current state: ${copy.state})`);
    }

    // Update copy: assign rack, set to available
    const [updated] = await tx
      .update(bookCopies)
      .set({ rackId, state: "available" })
      .where(eq(bookCopies.id, copyId))
      .returning();

    return updated;
  });
}

/* =====================================================
   Audit: get expected vs actual books in a rack
===================================================== */

// In-memory audit sessions (for simplicity; could be stored in DB)
const auditSessions = new Map<string, { startedAt: Date; scannedCopyIds: Set<string> }>();

export function startAudit(rackId: string) {
  auditSessions.set(rackId, { startedAt: new Date(), scannedCopyIds: new Set() });
  return { rackId, startedAt: new Date(), message: "Audit session started" };
}

export function recordAuditScan(rackId: string, copyId: string) {
  const session = auditSessions.get(rackId);
  if (!session) throw new AppError(404, "No active audit session for this rack");
  session.scannedCopyIds.add(copyId);
  return { rackId, copyId, scannedCount: session.scannedCopyIds.size };
}

export async function getAuditResult(rackId: string) {
  const session = auditSessions.get(rackId);
  if (!session) throw new AppError(404, "No active audit session for this rack");

  // Get expected copies in this rack
  const expectedCopies = await db
    .select({
      copyId: bookCopies.id,
      bookTitle: books.title,
      state: bookCopies.state,
    })
    .from(bookCopies)
    .innerJoin(books, eq(books.id, bookCopies.bookId))
    .where(eq(bookCopies.rackId, rackId));

  const expectedIds = new Set(expectedCopies.map((c) => c.copyId));
  const scanned = session.scannedCopyIds;

  const missing = expectedCopies.filter((c) => !scanned.has(c.copyId));
  const misplaced = [...scanned].filter((id) => !expectedIds.has(id));
  const found = expectedCopies.filter((c) => scanned.has(c.copyId));

  // Clean up session
  auditSessions.delete(rackId);

  return {
    rackId,
    startedAt: session.startedAt,
    completedAt: new Date(),
    expected: expectedCopies.length,
    scanned: scanned.size,
    found: found.length,
    missing,
    misplaced,
  };
}
