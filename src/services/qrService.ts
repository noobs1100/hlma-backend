import QRCode from "qrcode";
import PDFDocument from "pdfkit";
import { db } from "../db";
import { qrLabels } from "../db/schema";
import { inArray, and, eq } from "drizzle-orm";

/* =====================================================
   Base32 Crockford Character Set
   Excludes: I, L, O, U (to avoid confusion)
===================================================== */

const BASE32_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ID_LENGTH = 6;

/**
 * Generate a random Base32 Crockford ID
 */
export function generateBase32Id(): string {
  let id = "";
  const randomBytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  for (let i = 0; i < ID_LENGTH; i++) {
    id += BASE32_CHARS[randomBytes[i] % 32];
  }
  return id;
}

/**
 * Generate `count` unique Base32 IDs that do NOT exist in the
 * qr_labels table for the given type. Inserts them atomically
 * so concurrent calls never produce duplicates.
 *
 * Strategy:
 *   1. Generate a candidate set (with extra headroom)
 *   2. Filter out any that already exist in DB
 *   3. INSERT the survivors — the composite PK (type, id) means
 *      a concurrent insert of the same id will fail, so we retry.
 *   4. Repeat until we have enough.
 */
export async function generateUniqueIds(
  type: QRType,
  count: number
): Promise<{ ids: string[]; batchId: string }> {
  const batchId = crypto.randomUUID();
  const collected: string[] = [];

  // With 32^6 ≈ 1 billion possibilities, collisions are astronomically rare,
  // but we handle them properly anyway.
  const MAX_ATTEMPTS = 5;
  let attempt = 0;

  while (collected.length < count && attempt < MAX_ATTEMPTS) {
    attempt++;
    const remaining = count - collected.length;

    // Generate candidates with 20% headroom for potential collisions
    const candidateCount = Math.ceil(remaining * 1.2);
    const candidates = new Set<string>();
    while (candidates.size < candidateCount) {
      candidates.add(generateBase32Id());
    }

    // Remove any we already collected in this batch
    for (const id of collected) {
      candidates.delete(id);
    }

    const candidateArr = Array.from(candidates).slice(0, remaining);

    // Check which ones already exist in the DB
    const existing = await db
      .select({ id: qrLabels.id })
      .from(qrLabels)
      .where(
        and(
          eq(qrLabels.type, type),
          inArray(qrLabels.id, candidateArr)
        )
      );

    const existingSet = new Set(existing.map((r) => r.id));
    const fresh = candidateArr.filter((id) => !existingSet.has(id));

    if (fresh.length === 0) continue;

    // Insert atomically — if a concurrent request beat us to any ID,
    // the PK constraint will reject it and we retry
    try {
      await db.insert(qrLabels).values(
        fresh.map((id) => ({ id, type, batchId }))
      );
      collected.push(...fresh);
    } catch (error: any) {
      // Unique violation (PG error code 23505) — some IDs were taken
      // between our SELECT and INSERT. Retry with new candidates.
      if (error?.code === "23505") continue;
      throw error;
    }
  }

  if (collected.length < count) {
    throw new Error(
      `Could not generate ${count} unique IDs after ${MAX_ATTEMPTS} attempts`
    );
  }

  return { ids: collected, batchId };
}

/**
 * Validate a Base32 ID
 */
export function isValidBase32Id(id: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{6}$/.test(id);
}

/* =====================================================
   QR Payload Formats
===================================================== */

export type QRType = "book" | "rack";

export function formatQRPayload(type: QRType, id: string): string {
  const prefix = type === "book" ? "b" : "r";
  return `${prefix}:${id}`;
}

export function parseQRPayload(payload: string): { type: QRType; id: string } | null {
  const match = payload.match(/^([br]):([0-9A-HJKMNP-TV-Z]{6})$/);
  if (!match) return null;
  return {
    type: match[1] === "b" ? "book" : "rack",
    id: match[2],
  };
}

/* =====================================================
   QR Code Generation
===================================================== */

/**
 * Generate QR code as data URL (PNG base64)
 */
export async function generateQRDataURL(content: string): Promise<string> {
  return QRCode.toDataURL(content, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 150, // pixels for the QR itself
  });
}

/**
 * Generate QR code as Buffer (PNG)
 */
export async function generateQRBuffer(content: string): Promise<Buffer> {
  return QRCode.toBuffer(content, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 150,
  });
}

/* =====================================================
   PDF Generation for QR Labels
   
   A4 paper: 595.28 x 841.89 points (at 72 DPI)
   Target: ~140 labels per page
   
   Layout calculation:
   - 10 columns x 14 rows = 140 labels
   - Each label: ~56 x 56 points (~2cm x 2cm at 72 DPI)
   - With margins and spacing
===================================================== */

interface LabelConfig {
  pageWidth: number;
  pageHeight: number;
  marginX: number;
  marginY: number;
  cols: number;
  rows: number;
  labelWidth: number;
  labelHeight: number;
  qrSize: number;
  fontSize: number;
}

const A4_BOOK_CONFIG: LabelConfig = {
  pageWidth: 595.28,
  pageHeight: 841.89,
  marginX: 15,
  marginY: 15,
  cols: 10,
  rows: 14,
  labelWidth: 56.5, // (595.28 - 30) / 10
  labelHeight: 58, // (841.89 - 30) / 14
  qrSize: 42,
  fontSize: 6,
};

/* Rack labels: 5 columns x 4 rows = 20 per page
   Each label ~113 x 203 points (~4cm x 7cm)
   Much larger — easy to scan from a distance */
const A4_RACK_CONFIG: LabelConfig = {
  pageWidth: 595.28,
  pageHeight: 841.89,
  marginX: 15,
  marginY: 15,
  cols: 5,
  rows: 4,
  labelWidth: 113, // (595.28 - 30) / 5
  labelHeight: 203, // (841.89 - 30) / 4
  qrSize: 95,
  fontSize: 10,
};

function getConfig(type: QRType): LabelConfig {
  return type === "rack" ? A4_RACK_CONFIG : A4_BOOK_CONFIG;
}

/**
 * Generate PDF with QR code labels.
 * 
 * IDs are checked against the qr_labels table and persisted
 * BEFORE the PDF is built, so no two calls ever produce the same ID.
 * 
 * Returns both the PDF buffer and the list of IDs + batchId.
 */
export async function generateQRLabelsPDF(
  type: QRType,
  count: number
): Promise<{ pdf: Buffer; ids: string[]; batchId: string }> {
  const { ids, batchId } = await generateUniqueIds(type, count);
  const config = getConfig(type);
  const labelsPerPage = config.cols * config.rows;

  const pdf = await new Promise<Buffer>(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 0,
        autoFirstPage: false,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Generate QR codes in batches per page
      const totalPages = Math.ceil(count / labelsPerPage);

      for (let page = 0; page < totalPages; page++) {
        doc.addPage();

        const startIdx = page * labelsPerPage;
        const endIdx = Math.min(startIdx + labelsPerPage, count);

        for (let i = startIdx; i < endIdx; i++) {
          const id = ids[i];
          const payload = formatQRPayload(type, id);
          const qrBuffer = await generateQRBuffer(payload);

          const labelIdx = i - startIdx;
          const col = labelIdx % config.cols;
          const row = Math.floor(labelIdx / config.cols);

          const x = config.marginX + col * config.labelWidth;
          const y = config.marginY + row * config.labelHeight;

          // Center QR in label
          const qrX = x + (config.labelWidth - config.qrSize) / 2;
          const qrY = y + 2;

          // Draw QR code
          doc.image(qrBuffer, qrX, qrY, {
            width: config.qrSize,
            height: config.qrSize,
          });

          // Draw ID text below QR
          const textY = qrY + config.qrSize + 2;
          doc
            .fontSize(config.fontSize)
            .font("Helvetica")
            .fillColor("black")
            .text(id, x, textY, {
              width: config.labelWidth,
              align: "center",
            });
        }
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });

  return { pdf, ids, batchId };
}

/**
 * Get metadata about generated labels
 */
export function getLabelMetadata(type: QRType, count: number) {
  const config = getConfig(type);
  const labelsPerPage = config.cols * config.rows;
  return {
    totalLabels: count,
    labelsPerPage,
    totalPages: Math.ceil(count / labelsPerPage),
    labelSize: {
      width: `${Math.round(config.labelWidth / 2.83)}mm`,
      height: `${Math.round(config.labelHeight / 2.83)}mm`,
    },
  };
}

/* =====================================================
   Reprint — regenerate QR labels for known IDs
   
   Use case: label got damaged, lost, or unreadable.
   No new IDs are generated. We just verify the IDs
   exist (in qr_labels, book_copies, or racks) and
   render them into a fresh PDF.
===================================================== */

/**
 * Verify that all IDs are known to the system.
 * An ID is "known" if it exists in:
 *   - qr_labels (printed but maybe not yet registered)
 *   - book_copies (registered copies — may have been created manually)
 *   - racks (registered racks — may have been created manually)
 *
 * Returns the list of unknown IDs (empty = all valid).
 */
export async function findUnknownIds(
  type: QRType,
  ids: string[]
): Promise<string[]> {
  if (ids.length === 0) return [];

  // Check qr_labels first (covers batch-printed but unregistered)
  const inLabels = await db
    .select({ id: qrLabels.id })
    .from(qrLabels)
    .where(and(eq(qrLabels.type, type), inArray(qrLabels.id, ids)));
  const labelSet = new Set(inLabels.map((r) => r.id));

  // IDs not in qr_labels — check the entity table
  const remaining = ids.filter((id) => !labelSet.has(id));
  if (remaining.length === 0) return [];

  if (type === "book") {
    const inCopies = await db
      .select({ id: bookCopies.id })
      .from(bookCopies)
      .where(inArray(bookCopies.id, remaining));
    const copySet = new Set(inCopies.map((r) => r.id));
    return remaining.filter((id) => !copySet.has(id));
  } else {
    const inRacks = await db
      .select({ id: racks.id })
      .from(racks)
      .where(inArray(racks.id, remaining));
    const rackSet = new Set(inRacks.map((r) => r.id));
    return remaining.filter((id) => !rackSet.has(id));
  }
}

/**
 * Generate a reprint PDF for specific known IDs.
 * Uses the same grid layout as batch so reprints are visually identical.
 */
export async function generateReprintPDF(
  type: QRType,
  ids: string[]
): Promise<Buffer> {
  const config = getConfig(type);
  const labelsPerPage = config.cols * config.rows;
  const count = ids.length;

  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 0,
        autoFirstPage: false,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const totalPages = Math.ceil(count / labelsPerPage);

      for (let page = 0; page < totalPages; page++) {
        doc.addPage();

        const startIdx = page * labelsPerPage;
        const endIdx = Math.min(startIdx + labelsPerPage, count);

        for (let i = startIdx; i < endIdx; i++) {
          const id = ids[i];
          const payload = formatQRPayload(type, id);
          const qrBuffer = await generateQRBuffer(payload);

          const labelIdx = i - startIdx;
          const col = labelIdx % config.cols;
          const row = Math.floor(labelIdx / config.cols);

          const x = config.marginX + col * config.labelWidth;
          const y = config.marginY + row * config.labelHeight;

          const qrX = x + (config.labelWidth - config.qrSize) / 2;
          const qrY = y + 2;

          doc.image(qrBuffer, qrX, qrY, {
            width: config.qrSize,
            height: config.qrSize,
          });

          const textY = qrY + config.qrSize + 2;
          doc
            .fontSize(config.fontSize)
            .font("Helvetica")
            .fillColor("black")
            .text(id, x, textY, {
              width: config.labelWidth,
              align: "center",
            });
        }
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
