import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { uploadMiddleware } from "../uploads-storage.js";
import { getXlsxDiagnostics, parseUploadFile } from "../../domain/services/upload-parser-service.js";
import {
  approveUpload,
  createDraftEntitiesFromParsedRows,
  createUploadedDocument,
  getUploadDetail,
  getUploadKnowledgeChunks,
  getUploadParsedPreview,
  insertParsedRows,
  insertSkippedRows,
  listUploads,
  rejectUpload,
  updateUploadParseSummary
} from "../../domain/repositories/upload-repository.js";
import { ingestPdfToKnowledge } from "../../domain/services/pdf-ingestion-service.js";
import { getUploadKnowledgeCardSummary, listKnowledgeCards } from "../../domain/repositories/knowledge-card-repository.js";

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
      if (ext === ".pdf") {
        try {
          const result = await ingestPdfToKnowledge({
            uploadedDocumentId,
            filePath: req.file.path,
            fileName: req.file.originalname,
            vendor: parsedBody.data.vendor
          });
          await updateUploadParseSummary({
            uploadedDocumentId,
            parseStatus: "parsed",
            totalRows: result.chunkCount,
            parsedRows: result.chunkCount,
            skippedRows: 0
          });
          return res.status(201).json({
            uploaded_document_id: uploadedDocumentId,
            parse_status: "parsed",
            parsed_rows: result.chunkCount,
            skipped_rows: 0,
            parser_message: "PDF extracted and chunked into pending knowledge entries."
          });
        } catch (pdfError) {
          const message = pdfError instanceof Error ? pdfError.message : "PDF parser failed.";
          await updateUploadParseSummary({
            uploadedDocumentId,
            parseStatus: "needs_manual_review",
            parseError: message,
            totalRows: 0,
            parsedRows: 0,
            skippedRows: 0
          });
          return res.status(201).json({
            uploaded_document_id: uploadedDocumentId,
            parse_status: "needs_manual_review",
            parsed_rows: 0,
            skipped_rows: 0,
            parser_message: message
          });
        }
      }

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
        parsed.skippedRows.length > 0 ? "parsed_with_errors" : "parsed";
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
    const knowledgeChunks = await getUploadKnowledgeChunks(req.params.id);
    const knowledgeCards = await listKnowledgeCards({ uploadId: req.params.id });
    const cardSummary = await getUploadKnowledgeCardSummary(req.params.id);
    const parsedRows = preview.rows.filter((row) => !row.skip_reason).map((row) => ({
      ...row,
      sheet_name: (row.raw_json as Record<string, unknown>)?._meta
        ? ((row.raw_json as Record<string, unknown>)._meta as Record<string, unknown>).sheet_name
        : null,
      raw_row_number: (row.raw_json as Record<string, unknown>)?._meta
        ? ((row.raw_json as Record<string, unknown>)._meta as Record<string, unknown>).raw_row_number
        : null,
      category: (row.raw_json as Record<string, unknown>)?._meta
        ? ((row.raw_json as Record<string, unknown>)._meta as Record<string, unknown>).category
        : null
    }));
    const skippedRows = preview.rows.filter((row) => row.skip_reason).map((row) => ({
      ...row,
      sheet_name: (row.raw_json as Record<string, unknown>)?._meta
        ? ((row.raw_json as Record<string, unknown>)._meta as Record<string, unknown>).sheet_name
        : null,
      raw_row_number: (row.raw_json as Record<string, unknown>)?._meta
        ? ((row.raw_json as Record<string, unknown>)._meta as Record<string, unknown>).raw_row_number
        : null,
      category: (row.raw_json as Record<string, unknown>)?._meta
        ? ((row.raw_json as Record<string, unknown>)._meta as Record<string, unknown>).category
        : null
    }));
    return res.json({
      upload: preview.upload,
      summary: {
        total_rows: preview.rows.length,
        parsed_rows: parsedRows.length,
        skipped_rows: skippedRows.length
      },
      parsed_rows: parsedRows,
      skipped_rows: skippedRows
      ,
      knowledge_chunks: knowledgeChunks,
      knowledge_cards: knowledgeCards,
      knowledge_card_summary: cardSummary
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown preview error";
    return res.status(404).json({ error: message });
  }
});

uploadsRouter.get("/:id/parser-diagnostics", async (req, res) => {
  try {
    const detail = await getUploadDetail(req.params.id);
    const upload = detail.upload as Record<string, unknown>;
    const storedPath = String(upload.stored_file_path ?? "");
    const ext = String(upload.file_extension ?? "").toLowerCase();
    const diagnostics =
      ext === ".xlsx"
        ? getXlsxDiagnostics(storedPath)
        : {
            sheets: [
              {
                sheetName: "csv",
                headers: [],
                totalRows: detail.rows.length,
                relevant: true
              }
            ]
          };
    const skippedReasonCounts: Record<string, number> = {};
    for (const row of detail.rows.filter((r) => r.skip_reason)) {
      const reason = String(row.skip_reason);
      skippedReasonCounts[reason] = (skippedReasonCounts[reason] ?? 0) + 1;
    }
    return res.json({
      upload: detail.upload,
      diagnostics: {
        sheets: diagnostics.sheets,
        skipped_reason_counts: skippedReasonCounts
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown diagnostics error";
    return res.status(404).json({ error: message });
  }
});

uploadsRouter.get("/:id", async (req, res) => {
  try {
    const detail = await getUploadDetail(req.params.id);
    const knowledgeChunks = await getUploadKnowledgeChunks(req.params.id);
    const knowledgeCards = await listKnowledgeCards({ uploadId: req.params.id });
    const cardSummary = await getUploadKnowledgeCardSummary(req.params.id);
    const parsedRows = detail.rows.filter((row) => !row.skip_reason).map((row) => ({
      ...row,
      sheet_name: (row.raw_json as Record<string, unknown>)?._meta
        ? ((row.raw_json as Record<string, unknown>)._meta as Record<string, unknown>).sheet_name
        : null,
      raw_row_number: (row.raw_json as Record<string, unknown>)?._meta
        ? ((row.raw_json as Record<string, unknown>)._meta as Record<string, unknown>).raw_row_number
        : null,
      category: (row.raw_json as Record<string, unknown>)?._meta
        ? ((row.raw_json as Record<string, unknown>)._meta as Record<string, unknown>).category
        : null
    }));
    const skippedRows = detail.rows.filter((row) => row.skip_reason).map((row) => ({
      ...row,
      sheet_name: (row.raw_json as Record<string, unknown>)?._meta
        ? ((row.raw_json as Record<string, unknown>)._meta as Record<string, unknown>).sheet_name
        : null,
      raw_row_number: (row.raw_json as Record<string, unknown>)?._meta
        ? ((row.raw_json as Record<string, unknown>)._meta as Record<string, unknown>).raw_row_number
        : null,
      category: (row.raw_json as Record<string, unknown>)?._meta
        ? ((row.raw_json as Record<string, unknown>)._meta as Record<string, unknown>).category
        : null
    }));
    return res.json({
      upload: detail.upload,
      parsed_rows: parsedRows,
      skipped_rows: skippedRows,
      knowledge_chunks: knowledgeChunks,
      knowledge_cards: knowledgeCards,
      knowledge_card_summary: cardSummary
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
