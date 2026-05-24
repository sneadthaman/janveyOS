import { classifyDocumentText } from "./document-classifier.js";
import { extractEtaUpdateCandidates } from "./eta-candidate-extractor.js";
import {
  createDocumentExtraction,
  createEtaUpdateCandidates,
  findExtractionByDocumentId,
  findEtaCandidatesByExtractionId,
  updateIngestedDocumentType,
  type DocumentExtraction,
  type EtaUpdateCandidateRecord
} from "./document-extraction-repository.js";
import { findById } from "./ingested-document-repository.js";
import type { DocumentType, IngestedDocument } from "./ingested-document-types.js";

const EXTRACTOR_VERSION = "phase6c-rule-based-v1";

interface Deps {
  findDocumentById: (documentId: string) => Promise<IngestedDocument | null>;
  createDocumentExtraction: typeof createDocumentExtraction;
  createEtaUpdateCandidates: typeof createEtaUpdateCandidates;
  updateIngestedDocumentType: typeof updateIngestedDocumentType;
  findExtractionByDocumentId: typeof findExtractionByDocumentId;
  findEtaCandidatesByExtractionId: typeof findEtaCandidatesByExtractionId;
  classifyDocumentText: typeof classifyDocumentText;
  extractEtaUpdateCandidates: typeof extractEtaUpdateCandidates;
}

const defaultDeps: Deps = {
  findDocumentById: findById,
  createDocumentExtraction,
  createEtaUpdateCandidates,
  updateIngestedDocumentType,
  findExtractionByDocumentId,
  findEtaCandidatesByExtractionId,
  classifyDocumentText,
  extractEtaUpdateCandidates
};

export interface ProcessIngestedDocumentResult {
  document: IngestedDocument;
  extraction: DocumentExtraction;
  candidates: EtaUpdateCandidateRecord[];
}

export async function processIngestedDocumentWithDeps(
  documentId: string,
  deps: Partial<Deps>
): Promise<ProcessIngestedDocumentResult> {
  const resolved: Deps = { ...defaultDeps, ...deps };

  const document = await resolved.findDocumentById(documentId);
  if (!document) throw new Error(`Ingested document not found: ${documentId}`);
  if (document.extractionStatus !== "completed") {
    throw new Error(`Document extraction_status must be completed. Current status: ${document.extractionStatus}`);
  }

  const existingExtraction = await resolved.findExtractionByDocumentId(documentId);
  if (existingExtraction) {
    const existingCandidates = await resolved.findEtaCandidatesByExtractionId(existingExtraction.id);
    return {
      document,
      extraction: existingExtraction,
      candidates: existingCandidates
    };
  }

  const text = (document.extractedText ?? "").trim();
  const classification = resolved.classifyDocumentText(text);

  const extraction = await resolved.createDocumentExtraction({
    documentId,
    extractorVersion: EXTRACTOR_VERSION,
    classification: classification.classification as DocumentType,
    confidence: classification.confidence,
    rawExtractionJson: {
      reasons: classification.reasons,
      preview: text.slice(0, 1000)
    }
  });

  let candidates: EtaUpdateCandidateRecord[] = [];

  if (classification.classification === "eta_update") {
    const extractedCandidates = resolved.extractEtaUpdateCandidates(text);
    candidates = await resolved.createEtaUpdateCandidates(
      extractedCandidates.map((candidate) => ({
        documentExtractionId: extraction.id,
        poNumber: candidate.poNumber,
        etaDate: candidate.etaDate,
        trackingNumber: candidate.trackingNumber,
        carrier: candidate.carrier,
        itemNumber: candidate.itemNumber,
        appliesToEntirePo: candidate.appliesToEntirePo,
        confidence: candidate.confidence,
        rawContext: candidate.rawContext
      }))
    );
  }

  const updatedDocument = await resolved.updateIngestedDocumentType({
    documentId,
    documentType: classification.classification as DocumentType
  });

  return {
    document: updatedDocument,
    extraction,
    candidates
  };
}

export async function processIngestedDocument(documentId: string): Promise<ProcessIngestedDocumentResult> {
  return processIngestedDocumentWithDeps(documentId, {});
}
