import { supabaseAdminClient } from "../../integrations/supabase/client.js";
import { findDocumentExtractionById, findEtaUpdateCandidateById } from "./document-extraction-repository.js";
import { findById as findIngestedDocumentById } from "./ingested-document-repository.js";

export type EtaCandidateReviewStatus = "pending" | "approved" | "rejected";

export interface EtaCandidateReview {
  id: string;
  etaUpdateCandidateId: string;
  reviewStatus: EtaCandidateReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewerNotes: string | null;
  actionRequestId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EtaCandidateReviewWithContext {
  review: EtaCandidateReview;
  candidate: Awaited<ReturnType<typeof findEtaUpdateCandidateById>>;
  extraction: Awaited<ReturnType<typeof findDocumentExtractionById>>;
  document: Awaited<ReturnType<typeof findIngestedDocumentById>>;
}

interface ReviewRepositoryDeps {
  findById: (reviewId: string) => Promise<Record<string, unknown> | null>;
  findByCandidateId: (candidateId: string) => Promise<Record<string, unknown> | null>;
  insertReview: (row: Record<string, unknown>) => Promise<Record<string, unknown>>;
  listPending: (limit: number) => Promise<Record<string, unknown>[]>;
  updateById: (id: string, patch: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

function normalizeReview(row: Record<string, unknown>): EtaCandidateReview {
  return {
    id: String(row.id ?? ""),
    etaUpdateCandidateId: String(row.eta_update_candidate_id ?? ""),
    reviewStatus: String(row.review_status ?? "pending") as EtaCandidateReviewStatus,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    reviewerNotes: row.reviewer_notes ? String(row.reviewer_notes) : null,
    actionRequestId: row.action_request_id ? String(row.action_request_id) : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

const defaultDeps: ReviewRepositoryDeps = {
  async findById(reviewId) {
    if (!supabaseAdminClient) throw new Error("Supabase is required for eta candidate reviews.");
    const { data, error } = await supabaseAdminClient.from("eta_candidate_reviews").select("*").eq("id", reviewId).maybeSingle();
    if (error) throw new Error(`Failed to load eta_candidate_reviews row by id: ${error.message}`);
    return (data as Record<string, unknown> | null) ?? null;
  },
  async findByCandidateId(candidateId) {
    if (!supabaseAdminClient) throw new Error("Supabase is required for eta candidate reviews.");
    const { data, error } = await supabaseAdminClient
      .from("eta_candidate_reviews")
      .select("*")
      .eq("eta_update_candidate_id", candidateId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load eta_candidate_reviews row: ${error.message}`);
    return (data as Record<string, unknown> | null) ?? null;
  },
  async insertReview(row) {
    if (!supabaseAdminClient) throw new Error("Supabase is required for eta candidate reviews.");
    const { data, error } = await supabaseAdminClient.from("eta_candidate_reviews").insert(row).select("*").single();
    if (error || !data) throw new Error(`Failed to create eta_candidate_reviews row: ${error?.message ?? "unknown"}`);
    return data as Record<string, unknown>;
  },
  async listPending(limit) {
    if (!supabaseAdminClient) throw new Error("Supabase is required for eta candidate reviews.");
    const { data, error } = await supabaseAdminClient
      .from("eta_candidate_reviews")
      .select("*")
      .eq("review_status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error(`Failed to list pending eta candidate reviews: ${error.message}`);
    return (data ?? []) as Record<string, unknown>[];
  },
  async updateById(id, patch) {
    if (!supabaseAdminClient) throw new Error("Supabase is required for eta candidate reviews.");
    const { data, error } = await supabaseAdminClient
      .from("eta_candidate_reviews")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) throw new Error(`Failed to update eta_candidate_reviews row: ${error?.message ?? "unknown"}`);
    return data as Record<string, unknown>;
  }
};

export async function findReviewByCandidateIdWithDeps(
  candidateId: string,
  deps: ReviewRepositoryDeps
): Promise<EtaCandidateReview | null> {
  const row = await deps.findByCandidateId(candidateId);
  return row ? normalizeReview(row) : null;
}

export async function findReviewByIdWithDeps(reviewId: string, deps: ReviewRepositoryDeps): Promise<EtaCandidateReview | null> {
  const row = await deps.findById(reviewId);
  return row ? normalizeReview(row) : null;
}

export async function createPendingReviewWithDeps(candidateId: string, deps: ReviewRepositoryDeps): Promise<EtaCandidateReview> {
  const existing = await findReviewByCandidateIdWithDeps(candidateId, deps);
  if (existing) return existing;

  const row = await deps.insertReview({
    eta_update_candidate_id: candidateId,
    review_status: "pending",
    updated_at: new Date().toISOString()
  });
  return normalizeReview(row);
}

export async function findPendingReviewsWithDeps(limit: number, deps: ReviewRepositoryDeps): Promise<EtaCandidateReview[]> {
  const rows = await deps.listPending(limit);
  return rows.map((row) => normalizeReview(row));
}

export async function approveReviewWithDeps(
  input: {
    reviewId: string;
    reviewedBy?: string | null;
    reviewerNotes?: string | null;
    actionRequestId: string;
  },
  deps: ReviewRepositoryDeps
): Promise<EtaCandidateReview> {
  const row = await deps.updateById(input.reviewId, {
    review_status: "approved",
    reviewed_by: input.reviewedBy ?? null,
    reviewed_at: new Date().toISOString(),
    reviewer_notes: input.reviewerNotes ?? null,
    action_request_id: input.actionRequestId
  });

  return normalizeReview(row);
}

export async function rejectReviewWithDeps(
  input: {
    reviewId: string;
    reviewedBy?: string | null;
    reviewerNotes?: string | null;
  },
  deps: ReviewRepositoryDeps
): Promise<EtaCandidateReview> {
  const row = await deps.updateById(input.reviewId, {
    review_status: "rejected",
    reviewed_by: input.reviewedBy ?? null,
    reviewed_at: new Date().toISOString(),
    reviewer_notes: input.reviewerNotes ?? null
  });

  return normalizeReview(row);
}

export async function createPendingReview(candidateId: string): Promise<EtaCandidateReview> {
  return createPendingReviewWithDeps(candidateId, defaultDeps);
}

export async function findReviewByCandidateId(candidateId: string): Promise<EtaCandidateReview | null> {
  return findReviewByCandidateIdWithDeps(candidateId, defaultDeps);
}

export async function findReviewById(reviewId: string): Promise<EtaCandidateReview | null> {
  return findReviewByIdWithDeps(reviewId, defaultDeps);
}

export async function loadReviewWithCandidate(reviewId: string): Promise<EtaCandidateReviewWithContext | null> {
  const review = await findReviewById(reviewId);
  if (!review) return null;

  const candidate = await findEtaUpdateCandidateById(review.etaUpdateCandidateId);
  if (!candidate) {
    return {
      review,
      candidate: null,
      extraction: null,
      document: null
    };
  }

  const extraction = await findDocumentExtractionById(candidate.documentExtractionId);
  const document = extraction ? await findIngestedDocumentById(extraction.documentId) : null;

  return {
    review,
    candidate,
    extraction,
    document
  };
}

export async function findPendingReviews(limit = 50): Promise<EtaCandidateReview[]> {
  return findPendingReviewsWithDeps(limit, defaultDeps);
}

export async function approveReview(input: {
  reviewId: string;
  reviewedBy?: string | null;
  reviewerNotes?: string | null;
  actionRequestId: string;
}): Promise<EtaCandidateReview> {
  return approveReviewWithDeps(input, defaultDeps);
}

export async function rejectReview(input: {
  reviewId: string;
  reviewedBy?: string | null;
  reviewerNotes?: string | null;
}): Promise<EtaCandidateReview> {
  return rejectReviewWithDeps(input, defaultDeps);
}
