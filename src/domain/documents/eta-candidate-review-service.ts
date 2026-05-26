import { createAgentActionRequest } from "../repositories/agent-log-repository.js";
import { findDocumentExtractionById, findEtaUpdateCandidateById } from "./document-extraction-repository.js";
import { findById as findIngestedDocumentById } from "./ingested-document-repository.js";
import { formatEtaConfidence } from "../services/slack/document-review-card.js";
import {
  approveReview,
  createPendingReview,
  findReviewById,
  findReviewByCandidateId,
  rejectReview,
  type EtaCandidateReview
} from "./eta-candidate-review-repository.js";

interface ApproveEtaCandidateInput {
  candidateId: string;
  reviewedBy?: string | null;
  reviewerNotes?: string | null;
  requestedBy?: string | null;
  source?: string | null;
}

interface RejectEtaCandidateInput {
  candidateId: string;
  reviewedBy?: string | null;
  reviewerNotes?: string | null;
}

interface ApproveEtaReviewInput {
  reviewId: string;
  reviewedBy?: string | null;
  reviewerNotes?: string | null;
  requestedBy?: string | null;
  source?: string | null;
}

interface RejectEtaReviewInput {
  reviewId: string;
  reviewedBy?: string | null;
  reviewerNotes?: string | null;
}

interface ReviewServiceDeps {
  findEtaUpdateCandidateById: typeof findEtaUpdateCandidateById;
  findDocumentExtractionById: typeof findDocumentExtractionById;
  findIngestedDocumentById: typeof findIngestedDocumentById;
  createPendingReview: typeof createPendingReview;
  findReviewById: typeof findReviewById;
  findReviewByCandidateId: typeof findReviewByCandidateId;
  approveReview: typeof approveReview;
  rejectReview: typeof rejectReview;
  createAgentActionRequest: typeof createAgentActionRequest;
}

const defaultDeps: ReviewServiceDeps = {
  findEtaUpdateCandidateById,
  findDocumentExtractionById,
  findIngestedDocumentById,
  createPendingReview,
  findReviewById,
  findReviewByCandidateId,
  approveReview,
  rejectReview,
  createAgentActionRequest
};

export async function createPendingReviewForCandidate(candidateId: string): Promise<EtaCandidateReview> {
  return defaultDeps.createPendingReview(candidateId);
}

export async function createPendingReviewForCandidateWithStatus(
  candidateId: string
): Promise<{ review: EtaCandidateReview; created: boolean }> {
  const existing = await defaultDeps.findReviewByCandidateId(candidateId);
  if (existing) return { review: existing, created: false };
  const review = await defaultDeps.createPendingReview(candidateId);
  return { review, created: true };
}

function ensureCandidateValue(value: string | null | undefined, fieldName: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`ETA candidate is missing required field: ${fieldName}`);
  return normalized;
}

export async function approveEtaCandidateWithDeps(
  input: ApproveEtaCandidateInput,
  deps: Partial<ReviewServiceDeps>
): Promise<{ review: EtaCandidateReview; actionRequestId: string }> {
  const resolved: ReviewServiceDeps = { ...defaultDeps, ...deps };
  const candidate = await resolved.findEtaUpdateCandidateById(input.candidateId);
  if (!candidate) throw new Error(`ETA candidate not found: ${input.candidateId}`);
  const extraction = await resolved.findDocumentExtractionById(candidate.documentExtractionId);
  const sourceDocumentId = extraction?.documentId ?? null;
  let sourceDocument: Awaited<ReturnType<typeof findIngestedDocumentById>> = null;
  if (sourceDocumentId) {
    try {
      sourceDocument = await resolved.findIngestedDocumentById(sourceDocumentId);
    } catch {
      sourceDocument = null;
    }
  }

  const poNumber = ensureCandidateValue(candidate.poNumber, "po_number");
  const etaDate = ensureCandidateValue(candidate.etaDate, "eta_date");

  const review = await resolved.createPendingReview(input.candidateId);

  if (review.reviewStatus === "approved") {
    if (!review.actionRequestId) {
      throw new Error("Approved review is missing action_request_id.");
    }
    return { review, actionRequestId: review.actionRequestId };
  }

  // Safer behavior: rejected reviews cannot be reopened via this path.
  if (review.reviewStatus === "rejected") {
    throw new Error("Rejected ETA candidate reviews cannot be approved. Create a new candidate instead.");
  }

  const confidenceLabel = formatEtaConfidence({
    confidence: candidate.confidence,
    etaDateSource: candidate.etaDateSource,
    extractionMethod: sourceDocument?.extractionMethod ?? null,
    ocrUsed: sourceDocument?.ocrUsed ?? false
  });
  const etaUpdateId = candidate.id;
  const updateScope = candidate.appliesToEntirePo ? "po_all_lines" : candidate.itemNumber ? "item_line" : "unknown";
  const etaSource = candidate.etaDateSource ?? "document_review";
  const sourceType = "document_review";
  const rawNotes = [
    "source=document_review",
    sourceDocument?.fileName ? `file=${sourceDocument.fileName}` : null,
    sourceDocument?.sourceSender ? `sender=${sourceDocument.sourceSender}` : null,
    candidate.carrier ? `carrier=${candidate.carrier}` : null,
    candidate.rawContext ? `context=${candidate.rawContext}` : null
  ]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join(" | ");

  const payload: Record<string, unknown> = {
    etaUpdateId,
    eta_update_id: etaUpdateId,
    poNumber,
    po_number: poNumber,
    etaDate,
    eta_date: etaDate,
    etaDateSource: candidate.etaDateSource,
    eta_date_source: candidate.etaDateSource,
    etaDateIsEstimated: candidate.etaDateIsEstimated,
    eta_date_is_estimated: candidate.etaDateIsEstimated,
    baseDate: candidate.baseDate,
    base_date: candidate.baseDate,
    baseDateSource: candidate.baseDateSource,
    base_date_source: candidate.baseDateSource,
    trackingNumber: candidate.trackingNumber,
    tracking_number: candidate.trackingNumber,
    carrier: candidate.carrier,
    itemNumber: candidate.itemNumber,
    item_number: candidate.itemNumber,
    appliesToEntirePo: candidate.appliesToEntirePo,
    applies_to_entire_po: candidate.appliesToEntirePo,
    appliesTo: candidate.appliesToEntirePo ? "all_open_po_lines" : candidate.itemNumber ? "item_line" : "unknown",
    applies_to: candidate.appliesToEntirePo ? "all_open_po_lines" : candidate.itemNumber ? "item_line" : "unknown",
    updateScope,
    update_scope: updateScope,
    confidenceLabel,
    confidence_label: confidenceLabel,
    extractionConfidence: confidenceLabel,
    extraction_confidence: confidenceLabel,
    etaSource,
    eta_source: etaSource,
    sourceType,
    source_type: sourceType,
    vendorName: candidate.carrier ?? "document_review_vendor",
    vendor_name: candidate.carrier ?? "document_review_vendor",
    rawNotes,
    raw_notes: rawNotes,
    sourceDocumentId,
    source_document_id: sourceDocumentId,
    sourceDocumentExtractionId: candidate.documentExtractionId,
    source_document_extraction_id: candidate.documentExtractionId,
    sourceCandidateId: candidate.id,
    source_candidate_id: candidate.id,
    extractionMethod: sourceDocument?.extractionMethod ?? null,
    extraction_method: sourceDocument?.extractionMethod ?? null,
    ocrUsed: sourceDocument?.ocrUsed ?? false,
    ocr_used: sourceDocument?.ocrUsed ?? false,
    rawContext: candidate.rawContext,
    raw_context: candidate.rawContext
  };

  const actionRequestId = await resolved.createAgentActionRequest({
    requestedBy: input.requestedBy ?? input.reviewedBy ?? "eta_candidate_review",
    source: input.source ?? "document_review",
    actionType: "eta_update",
    requiresApproval: true,
    approvalStatusTarget: "Pending Approval",
    inputJson: payload,
    previewJson: {
      summary: "ETA candidate approved for action request",
      candidateId: candidate.id,
      poNumber,
      etaDate,
      etaDateSource: candidate.etaDateSource,
      etaDateIsEstimated: candidate.etaDateIsEstimated,
      baseDate: candidate.baseDate,
      baseDateSource: candidate.baseDateSource,
      trackingNumber: candidate.trackingNumber,
      carrier: candidate.carrier,
      itemNumber: candidate.itemNumber,
      appliesToEntirePo: candidate.appliesToEntirePo
    },
    status: "pending"
  });

  const approved = await resolved.approveReview({
    reviewId: review.id,
    reviewedBy: input.reviewedBy ?? null,
    reviewerNotes: input.reviewerNotes ?? null,
    actionRequestId
  });

  return {
    review: approved,
    actionRequestId
  };
}

export async function approveEtaCandidate(input: ApproveEtaCandidateInput) {
  return approveEtaCandidateWithDeps(input, {});
}

export async function approveEtaReviewByIdWithDeps(
  input: ApproveEtaReviewInput,
  deps: Partial<ReviewServiceDeps>
): Promise<{ review: EtaCandidateReview; actionRequestId: string }> {
  const resolved: ReviewServiceDeps = { ...defaultDeps, ...deps };
  const review = await resolved.findReviewById(input.reviewId);
  if (!review) throw new Error(`ETA candidate review not found: ${input.reviewId}`);

  return approveEtaCandidateWithDeps(
    {
      candidateId: review.etaUpdateCandidateId,
      reviewedBy: input.reviewedBy,
      reviewerNotes: input.reviewerNotes,
      requestedBy: input.requestedBy,
      source: input.source
    },
    resolved
  );
}

export async function approveEtaReviewById(input: ApproveEtaReviewInput) {
  return approveEtaReviewByIdWithDeps(input, {});
}

export async function rejectEtaCandidateWithDeps(input: RejectEtaCandidateInput, deps: Partial<ReviewServiceDeps>) {
  const resolved: ReviewServiceDeps = { ...defaultDeps, ...deps };
  const candidate = await resolved.findEtaUpdateCandidateById(input.candidateId);
  if (!candidate) throw new Error(`ETA candidate not found: ${input.candidateId}`);

  const review = await resolved.createPendingReview(input.candidateId);
  if (review.reviewStatus === "rejected") return review;
  if (review.reviewStatus === "approved") {
    throw new Error("Approved ETA candidate reviews cannot be rejected via this path.");
  }

  return resolved.rejectReview({
    reviewId: review.id,
    reviewedBy: input.reviewedBy ?? null,
    reviewerNotes: input.reviewerNotes ?? null
  });
}

export async function rejectEtaCandidate(input: RejectEtaCandidateInput) {
  return rejectEtaCandidateWithDeps(input, {});
}

export async function rejectEtaReviewByIdWithDeps(input: RejectEtaReviewInput, deps: Partial<ReviewServiceDeps>) {
  const resolved: ReviewServiceDeps = { ...defaultDeps, ...deps };
  const review = await resolved.findReviewById(input.reviewId);
  if (!review) throw new Error(`ETA candidate review not found: ${input.reviewId}`);

  return rejectEtaCandidateWithDeps(
    {
      candidateId: review.etaUpdateCandidateId,
      reviewedBy: input.reviewedBy,
      reviewerNotes: input.reviewerNotes
    },
    resolved
  );
}

export async function rejectEtaReviewById(input: RejectEtaReviewInput) {
  return rejectEtaReviewByIdWithDeps(input, {});
}
