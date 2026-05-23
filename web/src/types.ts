export interface UploadRecord {
  id: string;
  original_file_name: string;
  parse_status: string;
  approval_status: string;
  parsed_rows: number;
  skipped_rows: number;
  pending_approval_count: number;
  approved_count: number;
  parsed_pending_count?: number;
  parsed_approved_count?: number;
  products_pending_count?: number;
  products_approved_count?: number;
  pricing_pending_count?: number;
  pricing_approved_count?: number;
  knowledge_pending_count?: number;
  knowledge_approved_count?: number;
  knowledge_cards_pending_count?: number;
  knowledge_cards_approved_count?: number;
  created_at: string;
  source_type?: string;
  source_url?: string | null;
}

export interface ParsedRowRecord {
  id: string;
  row_number: number;
  raw_row_number?: number | null;
  sheet_name?: string | null;
  category?: string | null;
  sku: string | null;
  product_name: string | null;
  list_price: number | null;
  dealer_net: number | null;
  true_cost: number | null;
  ed_data_sell_price: number | null;
  gross_profit: number | null;
  margin_percent: number | null;
  approved_status: string;
}

export interface SkippedRowRecord {
  id: string;
  row_number: number;
  raw_row_number?: number | null;
  sheet_name?: string | null;
  category?: string | null;
  skip_reason: string;
  raw_json: Record<string, unknown>;
}

export interface KnowledgeEntry {
  id: string;
  category?: string;
  source_type?: string;
  title: string;
  body: string;
  approved_status: "pending" | "approved" | "rejected";
  metadata_json: Record<string, unknown>;
}

export interface KnowledgeCard {
  id: string;
  uploaded_document_id: string;
  linked_product_id?: string | null;
  card_type: string;
  title: string;
  body: string;
  vendor?: string | null;
  category?: string | null;
  segment?: string | null;
  confidence_score?: number | null;
  source_type: string;
  source_url?: string | null;
  source_excerpt?: string | null;
  match_reason?: string | null;
  approved_status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
}

export interface RecommendationLog {
  id: string;
  rep_user_id: string;
  request_text: string;
  recommendation_json: {
    input?: Record<string, unknown>;
    output?: {
      why_it_fits?: string[];
      how_to_sell?: string[];
      knowledge_used?: Array<{
        title: string;
        category: string;
        source_type: string;
        matched_product_sku?: string | null;
      }>;
      score_details?: Array<{ sku: string; total_score: number }>;
      best_fit_product?: {
        product_name: string;
        sku: string;
        price?: number;
        margin_percent: number;
      };
      value_alternative?: {
        product_name: string;
        sku: string;
        price?: number;
        margin_percent: number;
      };
    };
  };
  created_at: string;
}

export interface SalesPlaybook {
  id: string;
  category: string;
  segment: string;
  required_questions: string[];
  recommendation_rules: string[];
  selling_points: string[];
  objections: string[];
  products_to_prioritize: string[];
  products_to_avoid: string[];
  created_at: string;
  updated_at: string;
}

export interface AgentToolCall {
  id: string;
  created_at: string;
  requested_by: string | null;
  source: string | null;
  tool_name: string;
  status: "completed" | "failed";
  latency_ms: number | null;
  error_message: string | null;
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown> | null;
}

export interface AgentActionRequest {
  id: string;
  created_at: string;
  requested_by: string | null;
  source: string | null;
  action_type: string;
  requires_approval?: boolean;
  approval_status_target?: string | null;
  status: "pending" | "approved" | "running" | "rejected" | "cancelled" | "executed" | "failed";
  input_json: Record<string, unknown>;
  preview_json: Record<string, unknown> | null;
  output_json?: Record<string, unknown> | null;
  approved_by: string | null;
  approved_at: string | null;
  executed_at: string | null;
  claimed_by?: string | null;
  claimed_at?: string | null;
  retry_count?: number;
  last_attempted_at?: string | null;
  error_message: string | null;
}

export interface AgentActionExecutionLog {
  attempt_number: number;
  status: "started" | "completed" | "failed";
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown> | null;
}
