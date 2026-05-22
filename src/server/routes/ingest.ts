import { Router } from "express";
import { z } from "zod";
import { createUploadedDocument, updateUploadParseSummary } from "../../domain/repositories/upload-repository.js";
import { ingestUrlToKnowledge } from "../../domain/services/url-ingestion-service.js";

const ingestUrlSchema = z.object({
  url: z.string().url(),
  vendor: z.enum(["Nilfisk", "Taski", "Triple-S"]),
  category: z.string().min(1),
  notes: z.string().optional()
});

export const ingestRouter = Router();

ingestRouter.post("/url", async (req, res) => {
  const parsed = ingestUrlSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const { url, vendor, category, notes } = parsed.data;
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "Only http/https URLs are allowed." });
    }
    const u = new URL(url);
    const fileName = `${u.hostname}${u.pathname}`.replace(/\/+/g, "/").slice(0, 250) || u.hostname;
    const uploadedDocumentId = await createUploadedDocument({
      originalFileName: fileName,
      storedFilePath: url,
      mimeType: "text/html",
      fileExtension: ".url",
      sourceType: "url",
      sourceUrl: url,
      notes,
      vendor,
      documentType: category
    });

    try {
      const result = await ingestUrlToKnowledge({
        uploadedDocumentId,
        url,
        vendor,
        category,
        notes
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
        page_title: result.pageTitle,
        chunks_created: result.chunkCount,
        summary_created: result.summaryCreated
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "URL ingestion failed.";
      await updateUploadParseSummary({
        uploadedDocumentId,
        parseStatus: "needs_manual_review",
        parseError: message,
        totalRows: 0,
        parsedRows: 0,
        skippedRows: 0
      });
      return res.status(400).json({
        uploaded_document_id: uploadedDocumentId,
        parse_status: "needs_manual_review",
        error: message
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown URL ingest error";
    return res.status(500).json({ error: message });
  }
});
