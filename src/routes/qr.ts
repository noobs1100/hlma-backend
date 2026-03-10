import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  generateQRLabelsPDF,
  generateReprintPDF,
  findUnknownIds,
  getLabelMetadata,
  isValidBase32Id,
  type QRType,
} from "../services/qrService";

/* =====================================================
   Validators
===================================================== */

const batchBody = z.object({
  count: z.coerce.number().int().min(1).max(1000),
});

const reprintBody = z.object({
  ids: z.array(z.string()).min(1).max(200),
});

const typeParam = z.object({
  type: z.enum(["book", "rack"]),
});

export async function qrRoutes(app: FastifyInstance) {
  /* -------------------------------------------------------
     POST /qr/:type/batch — generate batch of QR labels as PDF
     
     :type can be "book" or "rack"
     Body: { count: number }
     
     Returns PDF binary with QR code labels
  ------------------------------------------------------- */
  app.post("/qr/:type/batch", async (req, reply) => {
    const { type } = typeParam.parse(req.params);
    const { count } = batchBody.parse(req.body);

    const { pdf, ids, batchId } = await generateQRLabelsPDF(type as QRType, count);
    const metadata = getLabelMetadata(type as QRType, count);

    const filename = `${type}-labels-${count}-${Date.now()}.pdf`;

    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .header("X-Batch-Id", batchId)
      .header("X-Labels-Count", metadata.totalLabels.toString())
      .header("X-Labels-Per-Page", metadata.labelsPerPage.toString())
      .header("X-Pages-Count", metadata.totalPages.toString())
      .send(pdf);
  });

  /* -------------------------------------------------------
     GET /qr/:type/info — get info about label layout
     
     Returns metadata about label generation (for UI preview)
  ------------------------------------------------------- */
  app.get("/qr/:type/info", async (req, reply) => {
    // Validate type param
    const { type } = typeParam.parse(req.params);
    
    const query = z.object({
      count: z.coerce.number().int().min(1).max(1000).default(140),
    }).parse(req.query);

    const metadata = getLabelMetadata(type as QRType, query.count);
    return reply.send(metadata);
  });

  /* -------------------------------------------------------
     POST /qr/:type/reprint — reprint labels for known IDs
     
     Use case: label got lost, damaged, or unreadable.
     Body: { ids: ["ABC123", "XYZ789"] }
     
     Validates that every ID exists in the system (qr_labels,
     book_copies, or racks). Returns a PDF with the same
     grid layout as the original batch.
  ------------------------------------------------------- */
  app.post("/qr/:type/reprint", async (req, reply) => {
    const { type } = typeParam.parse(req.params);
    const { ids } = reprintBody.parse(req.body);

    // Validate all IDs are proper Base32 format
    const invalid = ids.filter((id) => !isValidBase32Id(id));
    if (invalid.length > 0) {
      return reply.status(400).send({
        error: "Invalid ID format",
        invalidIds: invalid,
      });
    }

    // Deduplicate
    const uniqueIds = [...new Set(ids)];

    // Verify every ID is known to the system
    const unknown = await findUnknownIds(type as QRType, uniqueIds);
    if (unknown.length > 0) {
      return reply.status(404).send({
        error: "Some IDs were never issued and cannot be reprinted",
        unknownIds: unknown,
      });
    }

    const pdf = await generateReprintPDF(type as QRType, uniqueIds);
    const metadata = getLabelMetadata(type as QRType, uniqueIds.length);
    const filename = `${type}-reprint-${uniqueIds.length}-${Date.now()}.pdf`;

    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .header("X-Labels-Count", metadata.totalLabels.toString())
      .header("X-Labels-Per-Page", metadata.labelsPerPage.toString())
      .header("X-Pages-Count", metadata.totalPages.toString())
      .send(pdf);
  });
}
