import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { uploadMiddleware } from "../uploads-storage.js";
import { parseUploadFile } from "../../domain/services/upload-parser-service.js";
import {
  approveUpload,
  createDraftEntitiesFromParsedRows,
  createUploadedDocument,
  getUploadDetail,
  getUploadParsedPreview,
  insertParsedRows,
  insertSkippedRows,
  listUploads,
  rejectUpload,
  updateUploadParseSummary
} from "../../domain/repositories/upload-repository.js";

const uploadRequestSchema = z.object({
  vendor: z.enum(["Nilfisk", "Taski", "Triple-S"]).default("Nilfisk"),
  documentType: z.string().default("price_sheet")
});

export const uploadsRouter = Router();

uploadsRouter.get("/", async (_req, res) => {
  try {
    const uploads = await listUploads();
    return res.json({ uploads });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown uploads list error";
    return res.status(500).json({ error: message });
  }
});

uploadsRouter.post("/", uploadMiddleware.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Missing required file field: file" });
    }
    const parsedBody = uploadRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: parsedBody.error.flatten() });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const uploadedDocumentId = await createUploadedDocument({
      originalFileName: req.file.originalname,
      storedFilePath: req.file.path,
      mimeType: req.file.mimetype,
      fileExtension: ext,
      vendor: parsedBody.data.vendor,
      documentType: parsedBody.data.documentType
    });

    try {
      const parsed = await parseUploadFile({
        filePath: req.file.path,
        originalFileName: req.file.originalname
      });
      await insertParsedRows({
        uploadedDocumentId,
        rows: parsed.parsedRows,
        vendor: parsedBody.data.vendor
      });
      await insertSkippedRows({
        uploadedDocumentId,
        skipped: parsed.skippedRows
      });
      await createDraftEntitiesFromParsedRows({ uploadedDocumentId });
      const parseStatus =
        ext === ".pdf"
          ? "not_supported"
          : parsed.skippedRows.length > 0
            ? "parsed_with_errors"
            : "parsed";
      await updateUploadParseSummary({
        uploadedDocumentId,
        parseStatus,
        parseError: parsed.parserMessage,
        totalRows: parsed.parsedRows.length + parsed.skippedRows.length,
        parsedRows: parsed.parsedRows.length,
        skippedRows: parsed.skippedRows.length
      });
      return res.status(201).json({
        uploaded_document_id: uploadedDocumentId,
        parse_status: parseStatus,
        parsed_rows: parsed.parsedRows.length,
        skipped_rows: parsed.skippedRows.length,
        parser_message: parsed.parserMessage ?? null
      });
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : "Unknown parse error";
      await updateUploadParseSummary({
        uploadedDocumentId,
        parseStatus: "failed",
        parseError: message,
        totalRows: 0,
        parsedRows: 0,
        skippedRows: 0
      });
      return res.status(400).json({
        uploaded_document_id: uploadedDocumentId,
        error: "Failed to parse upload",
        details: message
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown upload error";
    return res.status(500).json({ error: message });
  }
});

uploadsRouter.get("/:id/parsed-preview", async (req, res) => {
  try {
    const preview = await getUploadParsedPreview(req.params.id);
    const parsedRows = preview.rows.filter((row) => !row.skip_reason);
    const skippedRows = preview.rows.filter((row) => row.skip_reason);
    return res.json({
      upload: preview.upload,
      summary: {
        total_rows: preview.rows.length,
        parsed_rows: parsedRows.length,
        skipped_rows: skippedRows.length
      },
      parsed_rows: parsedRows,
      skipped_rows: skippedRows
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown preview error";
    return res.status(404).json({ error: message });
  }
});

uploadsRouter.get("/:id", async (req, res) => {
  try {
    const detail = await getUploadDetail(req.params.id);
    const parsedRows = detail.rows.filter((row) => !row.skip_reason);
    const skippedRows = detail.rows.filter((row) => row.skip_reason);
    return res.json({
      upload: detail.upload,
      parsed_rows: parsedRows,
      skipped_rows: skippedRows
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown upload detail error";
    return res.status(404).json({ error: message });
  }
});

uploadsRouter.post("/:id/approve", async (req, res) => {
  try {
    const result = await approveUpload(req.params.id);
    return res.json({
      uploaded_document_id: req.params.id,
      approved_rows: result.approvedCount
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown approve error";
    return res.status(400).json({ error: message });
  }
});

uploadsRouter.post("/:id/reject", async (req, res) => {
  try {
    const result = await rejectUpload(req.params.id);
    return res.json({
      uploaded_document_id: req.params.id,
      ...result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown reject error";
    return res.status(400).json({ error: message });
  }
});

uploadsRouter.post("/:id/reprocess", async (_req, res) => {
  return res.status(501).json({
    error: "Reprocess is not implemented yet.",
    placeholder: true
  });
});
