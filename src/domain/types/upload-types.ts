export interface ParsedUploadRow {
  rowNumber: number;
  rawRowNumber?: number;
  sheetName?: string;
  category?: string;
  raw: Record<string, unknown>;
  sku: string;
  productName: string;
  productDescription?: string;
  listPrice: number;
  dealerNet: number;
}

export interface SkippedUploadRow {
  rowNumber: number;
  rawRowNumber?: number;
  sheetName?: string;
  category?: string;
  raw: Record<string, unknown>;
  reason: string;
}
