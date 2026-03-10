import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { bookCopies, borrows, books, user } from "../db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import {
  copyIdParam,
  updateCopyBody,
  updateCopyStateBody,
  paginationQuery,
  registerCopyBody,
} from "../schemas/validators";
import { AppError, borrowCopy, returnCopy, transferCopy } from "../services/borrowService";
import { transferBody, borrowBody } from "../schemas/validators";

export async function copyRoutes(app: FastifyInstance) {
  /* -------------------------------------------------------
     POST /copies/register — lazy register a book copy
     
     Used for QR labels printed before database entry.
     The ID comes from pre-printed QR code.
  ------------------------------------------------------- */
  app.post("/copies/register", async (req, reply) => {
    const body = registerCopyBody.parse(req.body);

    // Check if copy already exists
    const [existing] = await db
      .select()
      .from(bookCopies)
      .where(eq(bookCopies.id, body.id));

    if (existing) {
      throw new AppError(409, "Copy with this ID already registered");
    }

    // Verify book exists
    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.id, body.bookId));

    if (!book) {
      throw new AppError(404, "Book not found");
    }

    // Create the copy
    const [copy] = await db
      .insert(bookCopies)
      .values({
        id: body.id,
        bookId: body.bookId,
        rackId: body.rackId,
        state: "available",
      })
      .returning();

    return reply.status(201).send(copy);
  });

  /* -------------------------------------------------------
     GET /copies/:copyId — get copy info
  ------------------------------------------------------- */
  app.get("/copies/:copyId", async (req, reply) => {
    const { copyId } = copyIdParam.parse(req.params);

    const result = await db
      .select({
        copy: bookCopies,
        book: books,
      })
      .from(bookCopies)
      .innerJoin(books, eq(books.id, bookCopies.bookId))
      .where(eq(bookCopies.id, copyId));

    if (!result.length) throw new AppError(404, "Book copy not found");

    const { copy, book } = result[0]!;
    return reply.send({ ...copy, book });
  });

  /* -------------------------------------------------------
     PATCH /copies/:copyId — update copy metadata
  ------------------------------------------------------- */
  app.patch("/copies/:copyId", async (req, reply) => {
    const { copyId } = copyIdParam.parse(req.params);
    const body = updateCopyBody.parse(req.body);

    const [copy] = await db
      .update(bookCopies)
      .set(body)
      .where(eq(bookCopies.id, copyId))
      .returning();

    if (!copy) throw new AppError(404, "Book copy not found");
    return reply.send(copy);
  });

  /* -------------------------------------------------------
     DELETE /copies/:copyId — remove a book copy
  ------------------------------------------------------- */
  app.delete("/copies/:copyId", async (req, reply) => {
    const { copyId } = copyIdParam.parse(req.params);

    // Don't allow deleting borrowed copies
    const [copy] = await db
      .select()
      .from(bookCopies)
      .where(eq(bookCopies.id, copyId));

    if (!copy) throw new AppError(404, "Book copy not found");
    if (copy.state === "borrowed") {
      throw new AppError(409, "Cannot delete a currently borrowed book copy");
    }

    await db.delete(bookCopies).where(eq(bookCopies.id, copyId));
    return reply.status(204).send();
  });

  /* -------------------------------------------------------
     GET /copies/:copyId/history — borrow history for a copy
  ------------------------------------------------------- */
  app.get("/copies/:copyId/history", async (req, reply) => {
    const { copyId } = copyIdParam.parse(req.params);
    const query = paginationQuery.parse(req.query);
    const offset = (query.page - 1) * query.limit;

    const history = await db
      .select({
        borrow: borrows,
        userName: user.name,
        userEmail: user.email,
      })
      .from(borrows)
      .innerJoin(user, eq(user.id, borrows.userId))
      .where(eq(borrows.copyId, copyId))
      .orderBy(desc(borrows.borrowedAt))
      .limit(query.limit)
      .offset(offset);

    return reply.send(history);
  });

  /* -------------------------------------------------------
     PATCH /copies/:copyId/state — update state
  ------------------------------------------------------- */
  app.patch("/copies/:copyId/state", async (req, reply) => {
    const { copyId } = copyIdParam.parse(req.params);
    const { state } = updateCopyStateBody.parse(req.body);

    const [copy] = await db
      .update(bookCopies)
      .set({ state })
      .where(eq(bookCopies.id, copyId))
      .returning();

    if (!copy) throw new AppError(404, "Book copy not found");
    return reply.send(copy);
  });

  /* -------------------------------------------------------
     POST /copies/:copyId/borrow — borrow a book copy
  ------------------------------------------------------- */
  app.post("/copies/:copyId/borrow", async (req, reply) => {
    const { copyId } = copyIdParam.parse(req.params);
    const body = borrowBody.parse(req.body ?? {});
    const userId = body.userId ?? req.user.id;

    const borrow = await borrowCopy(copyId, userId);
    return reply.status(201).send(borrow);
  });

  /* -------------------------------------------------------
     POST /copies/:copyId/return — return a book copy
  ------------------------------------------------------- */
  app.post("/copies/:copyId/return", async (req, reply) => {
    const { copyId } = copyIdParam.parse(req.params);
    const borrow = await returnCopy(copyId);
    return reply.send(borrow);
  });

  /* -------------------------------------------------------
     POST /copies/:copyId/transfer — transfer to another user
  ------------------------------------------------------- */
  app.post("/copies/:copyId/transfer", async (req, reply) => {
    const { copyId } = copyIdParam.parse(req.params);
    const { toUserId } = transferBody.parse(req.body);
    const borrow = await transferCopy(copyId, toUserId);
    return reply.status(201).send(borrow);
  });
}
