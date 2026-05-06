export type Vendor = "Nilfisk" | "Taski" | "Triple-S";

export interface RepRequestInput {
  userId: string;
  source: "slack" | "web";
  text: string;
  accountName?: string;
}

export interface RecommendationResult {
  id: string;
  summary: string;
  productRecommendations: Array<{
    sku: string;
    productName: string;
    vendor: Vendor;
    confidence: number;
    reason: string;
  }>;
  discoveryQuestions: string[];
  positioningTalkTrack: string[];
  pricingGuidance: {
    floorPrice?: number;
    targetPrice?: number;
    expectedMarginPct?: number;
    notes: string[];
  };
}
