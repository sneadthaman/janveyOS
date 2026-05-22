import path from "node:path";
import { parse as parseCsvSync } from "csv-parse/sync";
import * as XLSX from "xlsx";
import type { ParsedUploadRow, SkippedUploadRow } from "../types/upload-types.js";

interface ParseOutput {
  parsedRows: ParsedUploadRow[];
  skippedRows: SkippedUploadRow[];
  parserMessage?: string;
  diagnostics?: {
    sheets: Array<{
      sheetName: string;
      headers: string[];
      totalRows: number;
      relevant: boolean;
      reason?: string;
    }>;
    skippedReasonCounts: Record<string, number>;
  };
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

function rowsFromXlsxSheet(filePath: string, sheetName: string): Record<string, unknown>[] {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];
}

const ignoreSheetTerms = ["cover", "note", "readme", "index", "toc", "instruction"];
const autoscrubberTerms = ["scrubber", "autoscrubber", "floor scrubber", "rider", "walk-behind", "sc", "advance"];

function isRelevantSheet(sheetName: string) {
  const lower = sheetName.toLowerCase();
  return !ignoreSheetTerms.some((term) => lower.includes(term));
}

function detectCategory(sheetName: string, productName: string) {
  const text = `${sheetName} ${productName}`.toLowerCase();
  if (autoscrubberTerms.some((term) => text.includes(term))) return "autoscrubber";
  return "other";
}

export function getXlsxDiagnostics(filePath: string) {
  const workbook = XLSX.readFile(filePath);
  const sheets = workbook.SheetNames.map((sheetName) => {
    const rows = rowsFromXlsxSheet(filePath, sheetName);
    const headers = rows[0] ? Object.keys(rows[0]) : [];
    const relevant = isRelevantSheet(sheetName);
    return {
      sheetName,
      headers,
      totalRows: rows.length,
      relevant,
      reason: relevant ? undefined : "Ignored by sheet-name heuristic"
    };
  });
  return { sheets };
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
  let xlsxSheetRows: Array<{ sheetName: string; rows: Record<string, unknown>[] }> = [];
  const diagnostics: ParseOutput["diagnostics"] = { sheets: [], skippedReasonCounts: {} };
  if (ext === ".csv") {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(input.filePath, "utf8");
    rawRows = rowsFromCsv(content);
  } else if (ext === ".xlsx") {
    const workbook = XLSX.readFile(input.filePath);
    xlsxSheetRows = workbook.SheetNames.map((sheetName) => ({
      sheetName,
      rows: rowsFromXlsxSheet(input.filePath, sheetName)
    }));
    diagnostics.sheets = xlsxSheetRows.map((item) => ({
      sheetName: item.sheetName,
      headers: item.rows[0] ? Object.keys(item.rows[0]) : [],
      totalRows: item.rows.length,
      relevant: isRelevantSheet(item.sheetName),
      reason: isRelevantSheet(item.sheetName) ? undefined : "Ignored by sheet-name heuristic"
    }));
    rawRows = xlsxSheetRows.filter((s) => isRelevantSheet(s.sheetName)).flatMap((s) => s.rows);
  } else {
    throw new Error("Unsupported file extension for parsing.");
  }

  if (rawRows.length === 0) {
    return {
      parsedRows: [],
      skippedRows: [{ rowNumber: 0, raw: {}, reason: "No rows found in file." }],
      diagnostics
    };
  }

  const parsedRows: ParsedUploadRow[] = [];
  const skippedRows: SkippedUploadRow[] = [];
  const sheetWork =
    ext === ".xlsx"
      ? xlsxSheetRows.filter((s) => isRelevantSheet(s.sheetName))
      : [{ sheetName: "csv", rows: rawRows }];

  let globalRowCounter = 2;
  for (const sheet of sheetWork) {
    if (sheet.rows.length === 0) continue;
    const headers = Object.keys(sheet.rows[0]);
    const fieldMap = getFieldMap(headers);
    if (fieldMap.sku < 0 || fieldMap.productName < 0 || fieldMap.listPrice < 0 || fieldMap.dealerNet < 0) {
      skippedRows.push({
        rowNumber: globalRowCounter,
        rawRowNumber: 1,
        sheetName: sheet.sheetName,
        raw: {},
        reason: "Missing required pricing columns in sheet."
      });
      globalRowCounter += sheet.rows.length;
      continue;
    }

    for (let i = 0; i < sheet.rows.length; i += 1) {
      const raw = sheet.rows[i];
      const rowNumber = globalRowCounter;
      const rawRowNumber = i + 2;
      globalRowCounter += 1;
      const values = Object.values(raw);
      const sku = String(values[fieldMap.sku] ?? "").trim();
      const productName = String(values[fieldMap.productName] ?? "").trim();
      const listPrice = parseNumber(values[fieldMap.listPrice]);
      const dealerNet = parseNumber(values[fieldMap.dealerNet]);
      const category = detectCategory(sheet.sheetName, productName);

      if (!sku) {
        skippedRows.push({ rowNumber, rawRowNumber, sheetName: sheet.sheetName, category, raw, reason: "Missing SKU/item number." });
        continue;
      }
      if (!productName) {
        skippedRows.push({
          rowNumber,
          rawRowNumber,
          sheetName: sheet.sheetName,
          category,
          raw,
          reason: "Missing product name/description."
        });
        continue;
      }
      if (listPrice === null || dealerNet === null) {
        skippedRows.push({
          rowNumber,
          rawRowNumber,
          sheetName: sheet.sheetName,
          category,
          raw,
          reason: "Invalid list price or dealer net price."
        });
        continue;
      }
      parsedRows.push({
        rowNumber,
        rawRowNumber,
        sheetName: sheet.sheetName,
        category,
        raw,
        sku,
        productName,
        productDescription: productName,
        listPrice,
        dealerNet
      });
    }
  }
  for (const row of skippedRows) {
    diagnostics.skippedReasonCounts[row.reason] = (diagnostics.skippedReasonCounts[row.reason] ?? 0) + 1;
  }
  return { parsedRows, skippedRows, diagnostics };
}
