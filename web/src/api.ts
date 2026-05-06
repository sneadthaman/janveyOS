import type { KnowledgeEntry, RecommendationLog, SalesPlaybook, UploadRecord } from "./types";

export async function getUploads(): Promise<UploadRecord[]> {
  const response = await fetch("/api/uploads");
  if (!response.ok) throw new Error("Failed to fetch uploads");
  const json = await response.json();
  return json.uploads ?? [];
}

export async function getUploadDetail(uploadId: string) {
  const response = await fetch(`/api/uploads/${uploadId}`);
  if (!response.ok) throw new Error("Failed to fetch upload detail");
  return response.json();
}

export async function approveUpload(uploadId: string) {
  const response = await fetch(`/api/uploads/${uploadId}/approve`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to approve upload");
  return response.json();
}

export async function rejectUpload(uploadId: string) {
  const response = await fetch(`/api/uploads/${uploadId}/reject`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to reject upload");
  return response.json();
}

export async function reprocessUpload(uploadId: string) {
  const response = await fetch(`/api/uploads/${uploadId}/reprocess`, { method: "POST" });
  return response.json();
}

export async function getKnowledgePending(): Promise<KnowledgeEntry[]> {
  const response = await fetch("/api/knowledge?status=pending");
  if (!response.ok) throw new Error("Failed to fetch pending knowledge");
  const json = await response.json();
  return json.entries ?? [];
}

export async function approveKnowledge(knowledgeId: string) {
  const response = await fetch(`/api/knowledge/${knowledgeId}/approve`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to approve knowledge");
  return response.json();
}

export async function rejectKnowledge(knowledgeId: string) {
  const response = await fetch(`/api/knowledge/${knowledgeId}/reject`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to reject knowledge");
  return response.json();
}

export async function patchKnowledge(knowledgeId: string, payload: { title?: string; body?: string }) {
  const response = await fetch(`/api/knowledge/${knowledgeId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Failed to patch knowledge");
  return response.json();
}

export async function getRecentRecommendations(): Promise<RecommendationLog[]> {
  const response = await fetch("/api/recommendations/recent");
  if (!response.ok) throw new Error("Failed to fetch recommendations");
  const json = await response.json();
  return json.recommendations ?? [];
}

export async function reviewRecommendation(
  recommendationId: string,
  payload: { feedback: "good" | "bad" | "needs_correction"; notes?: string; created_by?: string }
) {
  const response = await fetch(`/api/recommendations/${recommendationId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Failed to submit review");
  return response.json();
}

export async function submitRecommendationFeedback(
  recommendationId: string,
  payload: {
    feedback:
      | "good_recommendation"
      | "bad_recommendation"
      | "needs_correction"
      | "wrong_product"
      | "bad_tone"
      | "missing_context";
    free_text_feedback?: string;
    created_by?: string;
  }
) {
  const response = await fetch(`/api/recommendations/${recommendationId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Failed to submit recommendation feedback");
  return response.json();
}

export async function getPlaybooks(category = "autoscrubber"): Promise<SalesPlaybook[]> {
  const response = await fetch(`/api/playbooks?category=${encodeURIComponent(category)}`);
  if (!response.ok) throw new Error("Failed to fetch playbooks");
  const json = await response.json();
  return json.playbooks ?? [];
}

export async function createPlaybook(payload: Omit<SalesPlaybook, "id" | "created_at" | "updated_at">) {
  const response = await fetch("/api/playbooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Failed to create playbook");
  return response.json();
}

export async function patchPlaybook(id: string, payload: Partial<SalesPlaybook>) {
  const response = await fetch(`/api/playbooks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Failed to update playbook");
  return response.json();
}

export async function removePlaybook(id: string) {
  const response = await fetch(`/api/playbooks/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to delete playbook");
  return response.json();
}
