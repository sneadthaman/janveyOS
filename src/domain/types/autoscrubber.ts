export interface AutoscrubberDiscoveryInput {
  customer_name?: string;
  customer_segment?: string;
  floor_type?: string;
  square_footage?: number;
  cleaning_frequency?: string;
  walk_behind_or_ride_on?: string;
  battery_preference?: string;
  budget?: number;
  existing_machine?: string;
  notes?: string;
  slack_user_id?: string;
}

export interface AutoscrubberRecommendationResponse {
  recommendation_id: string;
  no_approved_pricing?: boolean;
  knowledge_used: Array<{
    title: string;
    category: string;
    source_type: string;
    matched_product_sku?: string | null;
  }>;
  best_fit_product: {
    sku: string;
    product_name: string;
    vendor: string;
    price: number;
    true_cost: number;
    margin_percent: number;
  } | null;
  value_alternative: {
    sku: string;
    product_name: string;
    vendor: string;
    price: number;
    true_cost: number;
    margin_percent: number;
  } | null;
  why_it_fits: string[];
  how_to_sell: string[];
  objections: string[];
  questions_to_ask_next: string[];
  confidence_score: number;
  score_details: Array<{
    sku: string;
    total_score: number;
    breakdown: Record<string, number>;
  }>;
  ai_explanation: string;
}
