import type {
  AgentActionRequest,
  AgentActionExecutionLog,
  AgentToolCall,
  KnowledgeCard,
  KnowledgeEntry,
  RecommendationLog,
  SalesPlaybook,
  UploadRecord
} from "./types";

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

export const approveSource = approveUpload;

export async function rejectUpload(uploadId: string) {
  const response = await fetch(`/api/uploads/${uploadId}/reject`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to reject upload");
  return response.json();
}

export const rejectSource = rejectUpload;

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

export async function getKnowledgeCards(input: { status?: "pending" | "approved" | "rejected"; uploadId?: string } = {}): Promise<KnowledgeCard[]> {
  const query = new URLSearchParams();
  if (input.status) query.set("status", input.status);
  if (input.uploadId) query.set("uploadId", input.uploadId);
  const response = await fetch(`/api/knowledge-cards${query.toString() ? `?${query.toString()}` : ""}`);
  if (!response.ok) throw new Error("Failed to fetch knowledge cards");
  const json = await response.json();
  return json.cards ?? [];
}

export async function approveKnowledgeCard(id: string) {
  const response = await fetch(`/api/knowledge-cards/${id}/approve`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to approve knowledge card");
  return response.json();
}

export async function rejectKnowledgeCard(id: string) {
  const response = await fetch(`/api/knowledge-cards/${id}/reject`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to reject knowledge card");
  return response.json();
}

export async function patchKnowledgeCard(id: string, payload: { title?: string; body?: string }) {
  const response = await fetch(`/api/knowledge-cards/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Failed to patch knowledge card");
  return response.json();
}

export async function bulkSetKnowledgeCardStatus(ids: string[], status: "approved" | "rejected") {
  const response = await fetch("/api/knowledge-cards/bulk-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, status })
  });
  if (!response.ok) throw new Error("Failed bulk knowledge card status update");
  return response.json();
}

export async function autoReviewKnowledgeCards(uploadId: string, minConfidenceForApprove = 0.8, maxConfidenceForReject = 0.35) {
  const response = await fetch("/api/knowledge-cards/auto-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, minConfidenceForApprove, maxConfidenceForReject })
  });
  if (!response.ok) throw new Error("Failed to auto-review knowledge cards");
  return response.json();
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

export async function ingestUrl(payload: {
  url: string;
  vendor: "Nilfisk" | "Taski" | "Triple-S";
  category: string;
  notes?: string;
}) {
  const response = await fetch("/api/ingest/url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error ?? "Failed to ingest URL");
  return json;
}

export async function getAgentToolCalls(): Promise<AgentToolCall[]> {
  const response = await fetch("/api/agent/tool-calls");
  if (!response.ok) throw new Error("Failed to fetch agent tool calls");
  const json = await response.json();
  return json.tool_calls ?? [];
}

export async function getAgentActionRequests(): Promise<AgentActionRequest[]> {
  const response = await fetch("/api/agent/action-requests");
  if (!response.ok) throw new Error("Failed to fetch agent action requests");
  const json = await response.json();
  return json.action_requests ?? [];
}

export async function approveAgentActionRequest(id: string, approvedBy: string) {
  const response = await fetch(`/api/agent/action-requests/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved_by: approvedBy })
  });
  if (!response.ok) {
    const json = await response.json();
    throw new Error(json.error ?? "Failed to approve action request");
  }
  return response.json();
}

export async function rejectAgentActionRequest(id: string) {
  const response = await fetch(`/api/agent/action-requests/${id}/reject`, {
    method: "POST"
  });
  if (!response.ok) {
    const json = await response.json();
    throw new Error(json.error ?? "Failed to reject action request");
  }
  return response.json();
}

export async function getAgentActionExecutionLogs(id: string): Promise<AgentActionExecutionLog[]> {
  const response = await fetch(`/api/agent/action-requests/${id}/execution-logs`);
  if (!response.ok) throw new Error("Failed to fetch execution logs");
  const json = await response.json();
  return json.execution_logs ?? [];
}
