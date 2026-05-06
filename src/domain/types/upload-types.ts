export interface ParsedUploadRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  sku: string;
  productName: string;
  productDescription?: string;
  listPrice: number;
  dealerNet: number;
}

export interface SkippedUploadRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  reason: string;
}
