import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { bookCopies, books, borrows, racks, user } from "../db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { copyIdParam, rackIdParam, base32Id } from "../schemas/validators";
import { AppError, isValidBase32Id } from "../services/borrowService";

export async function scanRoutes(app: FastifyInstance) {
  /* -------------------------------------------------------
     GET /scan/book/:copyId — QR scan for a book copy
     Returns: title, author, rack, state, borrower
     
     For lazy registration: If copyId is valid Base32 format
     but not in database, returns {status: "unregistered", id}
  ------------------------------------------------------- */
  app.get("/scan/book/:copyId", async (req, reply) => {
    const params = req.params as { copyId: string };
    const copyId = params.copyId;

    // Check if it's a valid Base32 ID format
    const isValidFormat = /^[0-9A-HJKMNP-TV-Z]{6}$/.test(copyId);
    if (!isValidFormat) {
      throw new AppError(400, "Invalid copy ID format");
    }

    const result = await db
      .select({
        copyId: bookCopies.id,
        state: bookCopies.state,
        borrowedAt: bookCopies.borrowedAt,
        bookTitle: books.title,
        bookAuthor: books.author,
        bookIsbn: books.isbn,
        bookId: books.id,
        rackId: racks.id,
        rackRoom: racks.room,
        rackCupboard: racks.cupboard,
        rackNumber: racks.rackNumber,
      })
      .from(bookCopies)
      .innerJoin(books, eq(books.id, bookCopies.bookId))
      .leftJoin(racks, eq(racks.id, bookCopies.rackId))
      .where(eq(bookCopies.id, copyId));

    // Lazy registration: return unregistered status for valid but unknown IDs
    if (!result.length) {
      return reply.send({
        status: "unregistered",
        id: copyId,
        message: "This copy has not been registered yet",
      });
    }

    const row = result[0]!;

    // Get current borrower if any
    let borrower = null;
    if (row.state === "borrowed") {
      const borrowResult = await db
        .select({
          borrowId: borrows.id,
          borrowedAt: borrows.borrowedAt,
          userName: user.name,
          userEmail: user.email,
          userId: user.id,
        })
        .from(borrows)
        .innerJoin(user, eq(user.id, borrows.userId))
        .where(and(eq(borrows.copyId, copyId), isNull(borrows.returnedAt)));

      borrower = borrowResult[0] ?? null;
    }

    return reply.send({
      copyId: row.copyId,
      state: row.state,
      book: {
        id: row.bookId,
        title: row.bookTitle,
        author: row.bookAuthor,
        isbn: row.bookIsbn,
      },
      rack: row.rackId
        ? {
            id: row.rackId,
            room: row.rackRoom,
            cupboard: row.rackCupboard,
            rackNumber: row.rackNumber,
          }
        : null,
      borrower,
    });
  });

  /* -------------------------------------------------------
     GET /scan/rack/:rackId — QR scan for a rack
     Returns: rack info + expected books
     
     For lazy registration: If rackId is valid Base32 format
     but not in database, returns {status: "unregistered", id}
  ------------------------------------------------------- */
  app.get("/scan/rack/:rackId", async (req, reply) => {
    const params = req.params as { rackId: string };
    const rackId = params.rackId;

    // Check if it's a valid Base32 ID format
    const isValidFormat = /^[0-9A-HJKMNP-TV-Z]{6}$/.test(rackId);
    if (!isValidFormat) {
      throw new AppError(400, "Invalid rack ID format");
    }

    const [rack] = await db.select().from(racks).where(eq(racks.id, rackId));
    
    // Lazy registration: return unregistered status for valid but unknown IDs
    if (!rack) {
      return reply.send({
        status: "unregistered",
        id: rackId,
        message: "This rack has not been registered yet",
      });
    }

    const copies = await db
      .select({
        copyId: bookCopies.id,
        state: bookCopies.state,
        bookTitle: books.title,
        bookAuthor: books.author,
        bookId: books.id,
      })
      .from(bookCopies)
      .innerJoin(books, eq(books.id, bookCopies.bookId))
      .where(eq(bookCopies.rackId, rackId));

    return reply.send({
      rack,
      books: copies,
      totalCopies: copies.length,
    });
  });
}
