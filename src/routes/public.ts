import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { bookCopies, books, borrows, racks, user } from "../db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { copyIdParam } from "../schemas/validators";
import { AppError } from "../services/borrowService";

/**
 * Public routes - NO authentication required
 * These endpoints are meant for public QR code scanning
 */
export async function publicRoutes(app: FastifyInstance) {
  /* -------------------------------------------------------
     GET /public/book/:copyId — Public QR scan for a book copy
     
     Returns limited info suitable for public display:
     - Book title, author, ISBN
     - Current status (available, borrowed, lost, etc.)
     - Location (rack) if available
     - If borrowed: when it was borrowed (no user details for privacy)
     
     For lazy registration: If copyId is valid Base32 format
     but not in database, returns {status: "unregistered", id}
  ------------------------------------------------------- */
  app.get("/public/book/:copyId", async (req, reply) => {
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
        bookDescription: books.description,
        bookPublishedYear: books.publishedYear,
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
        message: "This book has not been registered yet. Please contact a librarian.",
      });
    }

    const row = result[0]!;

    // Build human-friendly status message
    let statusMessage: string;
    let isAvailable: boolean;

    switch (row.state) {
      case "available":
        statusMessage = "Available for borrowing";
        isAvailable = true;
        break;
      case "borrowed":
        statusMessage = "Currently borrowed";
        isAvailable = false;
        break;
      case "returned_pending":
        statusMessage = "Being returned - check back soon";
        isAvailable = false;
        break;
      case "lost":
        statusMessage = "Marked as lost";
        isAvailable = false;
        break;
      default:
        statusMessage = "Status unknown";
        isAvailable = false;
    }

    // Build location string
    let location: string | null = null;
    if (row.rackRoom) {
      const parts = [row.rackRoom];
      if (row.rackCupboard) parts.push(row.rackCupboard);
      if (row.rackNumber) parts.push(`Rack ${row.rackNumber}`);
      location = parts.join(" → ");
    }

    return reply.send({
      copyId: row.copyId,
      book: {
        title: row.bookTitle,
        author: row.bookAuthor,
        isbn: row.bookIsbn,
        description: row.bookDescription,
        publishedYear: row.bookPublishedYear,
      },
      status: {
        state: row.state,
        message: statusMessage,
        isAvailable,
        borrowedAt: row.state === "borrowed" ? row.borrowedAt : null,
      },
      location,
    });
  });

  /* -------------------------------------------------------
     GET /public/health — Health check endpoint
  ------------------------------------------------------- */
  app.get("/public/health", async (_req, reply) => {
    return reply.send({ status: "ok", timestamp: new Date().toISOString() });
  });
}
