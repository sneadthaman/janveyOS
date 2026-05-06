import path from "node:path";
import { parse as parseCsvSync } from "csv-parse/sync";
import * as XLSX from "xlsx";
import type { ParsedUploadRow, SkippedUploadRow } from "../types/upload-types.js";

interface ParseOutput {
  parsedRows: ParsedUploadRow[];
  skippedRows: SkippedUploadRow[];
  parserMessage?: string;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseNumber(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/[$, ]/g, "");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function getFieldMap(headers: string[]) {
  const normalized = headers.map(normalizeHeader);
  const find = (candidates: string[]) => normalized.findIndex((header) => candidates.includes(header));
  return {
    sku: find(["sku", "item", "itemnumber", "itemno", "partnumber", "partno"]),
    productName: find(["productname", "description", "productdescription", "modeldescription", "name"]),
    listPrice: find(["listprice", "suggestedlistprice", "msrp", "suggestedprice", "price"]),
    dealerNet: find(["dealernet", "dealernetprice", "netprice", "dealercost", "netcost", "dealer"])
  };
}

function rowsFromCsv(content: string): Record<string, unknown>[] {
  return parseCsvSync(content, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<
    string,
    unknown
  >[];
}

function rowsFromXlsx(filePath: string): Record<string, unknown>[] {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];
}

export async function parseUploadFile(input: {
  filePath: string;
  originalFileName: string;
}): Promise<ParseOutput> {
  const ext = path.extname(input.originalFileName).toLowerCase();
  if (ext === ".pdf") {
    return {
      parsedRows: [],
      skippedRows: [],
      parserMessage: "PDF accepted but parser not implemented yet. Upload is stored for future extraction."
    };
  }

  let rawRows: Record<string, unknown>[] = [];
  if (ext === ".csv") {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(input.filePath, "utf8");
    rawRows = rowsFromCsv(content);
  } else if (ext === ".xlsx") {
    rawRows = rowsFromXlsx(input.filePath);
  } else {
    throw new Error("Unsupported file extension for parsing.");
  }

  if (rawRows.length === 0) {
    return { parsedRows: [], skippedRows: [{ rowNumber: 0, raw: {}, reason: "No rows found in file." }] };
  }

  const headers = Object.keys(rawRows[0]);
  const fieldMap = getFieldMap(headers);
  if (fieldMap.sku < 0 || fieldMap.productName < 0 || fieldMap.listPrice < 0 || fieldMap.dealerNet < 0) {
    const missing = [
      fieldMap.sku < 0 ? "SKU/item number" : null,
      fieldMap.productName < 0 ? "product name/description" : null,
      fieldMap.listPrice < 0 ? "suggested list price" : null,
      fieldMap.dealerNet < 0 ? "dealer net price" : null
    ].filter(Boolean);
    throw new Error(`Missing required columns: ${missing.join(", ")}`);
  }

  const parsedRows: ParsedUploadRow[] = [];
  const skippedRows: SkippedUploadRow[] = [];
  for (let i = 0; i < rawRows.length; i += 1) {
    const raw = rawRows[i];
    const rowNumber = i + 2;
    const values = Object.values(raw);
    const sku = String(values[fieldMap.sku] ?? "").trim();
    const productName = String(values[fieldMap.productName] ?? "").trim();
    const listPrice = parseNumber(values[fieldMap.listPrice]);
    const dealerNet = parseNumber(values[fieldMap.dealerNet]);

    if (!sku) {
      skippedRows.push({ rowNumber, raw, reason: "Missing SKU/item number." });
      continue;
    }
    if (!productName) {
      skippedRows.push({ rowNumber, raw, reason: "Missing product name/description." });
      continue;
    }
    if (listPrice === null || dealerNet === null) {
      skippedRows.push({ rowNumber, raw, reason: "Invalid list price or dealer net price." });
      continue;
    }
    parsedRows.push({
      rowNumber,
      raw,
      sku,
      productName,
      productDescription: productName,
      listPrice,
      dealerNet
    });
  }
  return { parsedRows, skippedRows };
}
