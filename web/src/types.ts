export interface UploadRecord {
  id: string;
  original_file_name: string;
  parse_status: string;
  approval_status: string;
  parsed_rows: number;
  skipped_rows: number;
  pending_approval_count: number;
  approved_count: number;
  created_at: string;
}

export interface ParsedRowRecord {
  id: string;
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
  skip_reason: string;
  raw_json: Record<string, unknown>;
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  body: string;
  approved_status: "pending" | "approved" | "rejected";
  metadata_json: Record<string, unknown>;
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
