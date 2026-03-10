import { db } from "../db";
import { bookCopies, borrows, books, user } from "../db/schema";
import { eq, and, isNull } from "drizzle-orm";

/* =====================================================
   Borrow a book copy
===================================================== */

export async function borrowCopy(copyId: string, userId: string) {
  return await db.transaction(async (tx) => {
    // Check copy exists and is available
    const [copy] = await tx
      .select()
      .from(bookCopies)
      .where(eq(bookCopies.id, copyId))
      .for("update");

    if (!copy) throw new AppError(404, "Book copy not found");
    if (copy.state !== "available") {
      throw new AppError(409, `Book copy is not available (current state: ${copy.state})`);
    }

    // Check no active borrow exists (belt-and-suspenders with DB constraint)
    const [activeBorrow] = await tx
      .select()
      .from(borrows)
      .where(and(eq(borrows.copyId, copyId), isNull(borrows.returnedAt)));

    if (activeBorrow) {
      throw new AppError(409, "Book copy already has an active borrow");
    }

    const now = new Date();

    // Insert borrow record
    const [borrow] = await tx
      .insert(borrows)
      .values({ copyId, userId, borrowedAt: now })
      .returning();

    // Update copy state
    await tx
      .update(bookCopies)
      .set({ state: "borrowed", borrowedBy: userId, borrowedAt: now })
      .where(eq(bookCopies.id, copyId));

    return borrow;
  });
}

/* =====================================================
   Return a book copy
===================================================== */

export async function returnCopy(copyId: string) {
  return await db.transaction(async (tx) => {
    const [copy] = await tx
      .select()
      .from(bookCopies)
      .where(eq(bookCopies.id, copyId))
      .for("update");

    if (!copy) throw new AppError(404, "Book copy not found");
    if (copy.state !== "borrowed") {
      throw new AppError(409, `Book copy is not borrowed (current state: ${copy.state})`);
    }

    // Find active borrow
    const [activeBorrow] = await tx
      .select()
      .from(borrows)
      .where(and(eq(borrows.copyId, copyId), isNull(borrows.returnedAt)));

    if (!activeBorrow) {
      throw new AppError(409, "No active borrow found for this copy");
    }

    const now = new Date();

    // Close the borrow
    const [updated] = await tx
      .update(borrows)
      .set({ returnedAt: now })
      .where(eq(borrows.id, activeBorrow.id))
      .returning();

    // Update copy state to returned_pending (needs to be placed in rack)
    await tx
      .update(bookCopies)
      .set({ state: "returned_pending", borrowedBy: null, borrowedAt: null })
      .where(eq(bookCopies.id, copyId));

    return updated;
  });
}

/* =====================================================
   Transfer a book from one user to another
===================================================== */

export async function transferCopy(copyId: string, toUserId: string) {
  return await db.transaction(async (tx) => {
    const [copy] = await tx
      .select()
      .from(bookCopies)
      .where(eq(bookCopies.id, copyId))
      .for("update");

    if (!copy) throw new AppError(404, "Book copy not found");
    if (copy.state !== "borrowed") {
      throw new AppError(409, `Book copy is not borrowed (current state: ${copy.state})`);
    }

    // Verify target user exists
    const [targetUser] = await tx.select().from(user).where(eq(user.id, toUserId));
    if (!targetUser) throw new AppError(404, "Target user not found");

    // Find active borrow
    const [activeBorrow] = await tx
      .select()
      .from(borrows)
      .where(and(eq(borrows.copyId, copyId), isNull(borrows.returnedAt)));

    if (!activeBorrow) throw new AppError(409, "No active borrow found");

    const now = new Date();

    // 1. Close existing borrow
    await tx
      .update(borrows)
      .set({ returnedAt: now })
      .where(eq(borrows.id, activeBorrow.id));

    // 2. Insert new borrow for target user
    const [newBorrow] = await tx
      .insert(borrows)
      .values({ copyId, userId: toUserId, borrowedAt: now })
      .returning();

    // 3. Update book_copies.borrowed_by
    await tx
      .update(bookCopies)
      .set({ borrowedBy: toUserId, borrowedAt: now })
      .where(eq(bookCopies.id, copyId));

    return newBorrow;
  });
}

/* =====================================================
   Application Error
===================================================== */

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "AppError";
  }
}
