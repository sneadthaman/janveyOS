export type KnowledgeCardType =
  | "product_insight"
  | "application_fit"
  | "selling_point"
  | "objection"
  | "competitive_note"
  | "maintenance_service_note"
  | "spec_fact"
  | "discovery_question";

export type KnowledgeApprovalStatus = "pending" | "approved" | "rejected";

export interface KnowledgeCard {
  id: string;
  uploaded_document_id: string;
  linked_product_id: string | null;
  card_type: KnowledgeCardType;
  title: string;
  body: string;
  vendor: string | null;
  category: string | null;
  segment: string | null;
  confidence_score: number | null;
  source_type: string;
  source_url: string | null;
  source_excerpt: string | null;
  match_reason: string | null;
  approved_status: KnowledgeApprovalStatus;
  created_at: string;
  updated_at: string;
}
