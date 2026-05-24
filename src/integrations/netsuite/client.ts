import { config } from "../../shared/config.js";
import { createHmac, randomBytes } from "node:crypto";

export interface QuoteLookupResult {
  success: boolean;
  quote?: {
    internalId?: string | number;
    tranId?: string;
    customerName?: string;
    status?: string;
    total?: string | number;
    tranDate?: string;
    expirationDate?: string;
    expired?: boolean;
  };
  quotes?: Array<{
    internalId?: string | number;
    tranId?: string;
    customerName?: string;
    status?: string;
    total?: string | number;
    tranDate?: string;
    expirationDate?: string;
    expired?: boolean;
  }>;
  message?: string;
  code?: string;
  details?: unknown;
}

export interface QuoteToSalesOrderTransformInput {
  quoteInternalId: string;
  quoteTranId?: string;
  poNumber?: string;
  memo?: string;
  approvalStatusTarget?: string;
  agentActionRequestId?: string;
}

export interface QuoteToSalesOrderTransformResult {
  success: boolean;
  operation?: string;
  source?: {
    fromType?: string;
    fromId?: string;
  };
  target?: {
    toType?: string;
    internalId?: string;
    tranId?: string;
  };
  orderStatus?: string;
  orderStatusValue?: string;
  safety?: {
    autoApprove?: boolean;
    autoFulfill?: boolean;
    autoBill?: boolean;
  };
  message?: string;
  code?: string;
  details?: unknown;
}

export type SalesOrderVerificationResult =
  | {
      status: "exists";
      internalId: string;
      tranId?: string;
      nsStatus?: string;
    }
  | {
      status: "missing";
      internalId: string;
      errorCode?: string;
      safeMessage?: string;
    }
  | {
      status: "verification_error";
      internalId: string;
      errorCode?: string;
      safeMessage?: string;
    };

export interface OpenPurchaseOrderLookupLine {
  lineId?: string;
  lineUniqueKey?: string;
  itemInternalId?: string;
  itemNumber?: string;
  description?: string;
  quantity?: number;
  quantityReceived?: number;
  quantityRemaining?: number;
  expectedReceiptDate?: string;
  isClosed?: boolean;
}

export interface OpenPurchaseOrderLookupResult {
  success: boolean;
  poInternalId?: string;
  tranId?: string;
  vendorName?: string;
  status?: string;
  lines: OpenPurchaseOrderLookupLine[];
  code?: string;
  message?: string;
  details?: unknown;
}

export interface UpdatePurchaseOrderEtaInput {
  po: string;
  etaDate: string;
  etaConfidence?: string;
  trackingNumber?: string | null;
  etaSource?: string;
  etaNotes?: string;
  updateOwner?: string;
  items?: Array<{
    item?: string | null;
    itemInternalId?: string | null;
    etaDate?: string | null;
    trackingNumber?: string | null;
    confidence?: string | null;
    notes?: string | null;
  }>;
}

export interface UpdatePurchaseOrderEtaResult {
  success: boolean;
  code?: string;
  message?: string;
  details?: unknown;
  poInternalId?: string;
  poNumber?: string;
  linesUpdated?: number;
}

export class NetSuiteRestletError extends Error {
  code?: string;
  details?: unknown;
  httpStatus?: number;

  constructor(message: string, options?: { code?: string; details?: unknown; httpStatus?: number }) {
    super(message);
    this.name = "NetSuiteRestletError";
    this.code = options?.code;
    this.details = options?.details;
    this.httpStatus = options?.httpStatus;
  }
}

function normalizeQuoteLookupResponse(raw: Record<string, unknown>): QuoteLookupResult {
  const quote = (raw.quote ?? undefined) as QuoteLookupResult["quote"];
  const quotes = Array.isArray(raw.quotes) ? (raw.quotes as QuoteLookupResult["quotes"]) : undefined;
  return {
    success: raw.success === true,
    quote,
    quotes,
    message: typeof raw.message === "string" ? raw.message : undefined,
    code: typeof raw.code === "string" ? raw.code : undefined,
    details: raw.details
  };
}

function percentEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildOAuthAuthorizationHeader(url: string) {
  const accountId = config.NETSUITE_ACCOUNT_ID;
  const consumerKey = config.NETSUITE_CONSUMER_KEY;
  const consumerSecret = config.NETSUITE_CONSUMER_SECRET;
  const tokenId = config.NETSUITE_TOKEN_ID;
  const tokenSecret = config.NETSUITE_TOKEN_SECRET;

  if (!accountId || !consumerKey || !consumerSecret || !tokenId || !tokenSecret) return null;

  const nonce = randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const parsedUrl = new URL(url);

  const oauthParams: Array<[string, string]> = [
    ["oauth_consumer_key", consumerKey],
    ["oauth_token", tokenId],
    ["oauth_signature_method", "HMAC-SHA256"],
    ["oauth_timestamp", timestamp],
    ["oauth_nonce", nonce],
    ["oauth_version", "1.0"]
  ];

  const queryParams: Array<[string, string]> = [];
  parsedUrl.searchParams.forEach((value, key) => {
    queryParams.push([key, value]);
  });

  const allParams = [...oauthParams, ...queryParams].map(([key, value]) => [percentEncode(key), percentEncode(value)] as const);
  allParams.sort((a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return 0;
  });

  const normalizedParams = allParams.map(([key, value]) => `${key}=${value}`).join("&");
  const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`;
  const signatureBaseString = ["POST", percentEncode(baseUrl), percentEncode(normalizedParams)].join("&");
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  const oauthSignature = createHmac("sha256", signingKey).update(signatureBaseString).digest("base64");

  const headerParams: Array<[string, string]> = [
    ["realm", accountId],
    ...oauthParams,
    ["oauth_signature", oauthSignature]
  ];

  return `OAuth ${headerParams.map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`).join(", ")}`;
}

function buildNetSuiteAuthorizationHeader(url: string) {
  if (config.NETSUITE_RESTLET_AUTH_HEADER) {
    return config.NETSUITE_RESTLET_AUTH_HEADER;
  }
  return buildOAuthAuthorizationHeader(url);
}

function parseJsonObject(text: string) {
  const parsed = JSON.parse(text || "{}") as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {} as Record<string, unknown>;
  }
  return parsed as Record<string, unknown>;
}

const NETSUITE_MISSING_RECORD_CODES = new Set([
  "RCRD_DSNT_EXIST",
  "INVALID_KEY_OR_REF",
  "SSS_INVALID_INTERNAL_ID",
  "RECORD_NOT_FOUND"
]);

function isNetSuiteMissingRecordCode(code: string | undefined) {
  if (!code) return false;
  return NETSUITE_MISSING_RECORD_CODES.has(code);
}

function indicatesMissingRecordFromMessage(message: string | undefined) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("does not exist") ||
    lower.includes("not found") ||
    lower.includes("invalid internal id") ||
    lower.includes("record was not found")
  );
}

function classifySalesOrderLookupFailure(input: {
  internalId: string;
  httpStatus?: number;
  parsedBody?: Record<string, unknown>;
  parseError?: unknown;
  fetchError?: unknown;
}): SalesOrderVerificationResult {
  if (input.fetchError) {
    return {
      status: "verification_error",
      internalId: input.internalId,
      errorCode: "LOOKUP_ERROR",
      safeMessage: input.fetchError instanceof Error ? input.fetchError.message : "Sales order lookup failed before reaching NetSuite."
    };
  }

  if (input.parseError) {
    return {
      status: "verification_error",
      internalId: input.internalId,
      errorCode: "INVALID_JSON",
      safeMessage: "Sales order lookup returned invalid JSON."
    };
  }

  const raw = input.parsedBody ?? {};
  const nestedError = raw.error && typeof raw.error === "object" ? (raw.error as Record<string, unknown>) : undefined;
  const topCode = typeof raw.code === "string" ? raw.code : undefined;
  const nestedCode = typeof nestedError?.code === "string" ? nestedError.code : undefined;
  const errorCode = topCode ?? nestedCode;
  const responseMessage = typeof raw.message === "string" ? raw.message : typeof nestedError?.message === "string" ? nestedError.message : undefined;

  if (isNetSuiteMissingRecordCode(errorCode) || indicatesMissingRecordFromMessage(responseMessage)) {
    return {
      status: "missing",
      internalId: input.internalId,
      errorCode: errorCode ?? "RCRD_DSNT_EXIST",
      safeMessage: responseMessage ?? "Sales Order not found."
    };
  }

  if (input.httpStatus === 401 || input.httpStatus === 403) {
    return {
      status: "verification_error",
      internalId: input.internalId,
      errorCode: errorCode ?? `HTTP_${input.httpStatus}`,
      safeMessage: responseMessage ?? "Sales order lookup authentication/authorization failed."
    };
  }

  if (input.httpStatus === 404) {
    return {
      status: "verification_error",
      internalId: input.internalId,
      errorCode: errorCode ?? "HTTP_404",
      safeMessage: responseMessage ?? "Sales order lookup endpoint not found."
    };
  }

  return {
    status: "verification_error",
    internalId: input.internalId,
    errorCode: errorCode ?? (input.httpStatus ? `HTTP_${input.httpStatus}` : "UNKNOWN_ERROR"),
    safeMessage: responseMessage ?? "Sales order verification returned an unexpected result."
  };
}

function normalizeQuoteToSoTransformResponse(raw: Record<string, unknown>): QuoteToSalesOrderTransformResult {
  const source = raw.source as QuoteToSalesOrderTransformResult["source"] | undefined;
  const target = raw.target as QuoteToSalesOrderTransformResult["target"] | undefined;
  const safety = raw.safety as QuoteToSalesOrderTransformResult["safety"] | undefined;

  return {
    success: raw.success === true,
    operation: typeof raw.operation === "string" ? raw.operation : undefined,
    source,
    target,
    orderStatus: typeof raw.orderStatus === "string" ? raw.orderStatus : undefined,
    orderStatusValue: typeof raw.orderStatusValue === "string" ? raw.orderStatusValue : undefined,
    safety,
    message: typeof raw.message === "string" ? raw.message : undefined,
    code: typeof raw.code === "string" ? raw.code : undefined,
    details: raw.details
  };
}

export async function lookupQuoteByTranId(quoteTranId: string): Promise<QuoteLookupResult> {
  const hasLookupUrl = Boolean(config.NETSUITE_QUOTE_LOOKUP_RESTLET_URL);
  const hasOAuthCredentials = Boolean(
    config.NETSUITE_ACCOUNT_ID &&
      config.NETSUITE_CONSUMER_KEY &&
      config.NETSUITE_CONSUMER_SECRET &&
      config.NETSUITE_TOKEN_ID &&
      config.NETSUITE_TOKEN_SECRET
  );
  if (!config.NETSUITE_QUOTE_LOOKUP_RESTLET_URL) {
    throw new Error("NETSUITE_QUOTE_LOOKUP_RESTLET_URL is not configured.");
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json"
  };

  const authHeader = buildNetSuiteAuthorizationHeader(config.NETSUITE_QUOTE_LOOKUP_RESTLET_URL);
  if (authHeader) headers.authorization = authHeader;

  console.log("[netsuite] lookupQuoteByTranId start", {
    hasLookupUrl,
    hasOAuthCredentials,
    hasAuthHeader: Boolean(headers.authorization),
    quoteTranId
  });
  console.log("[netsuite] lookupQuoteByTranId request body", { quote_number: quoteTranId });

  try {
    const response = await fetch(config.NETSUITE_QUOTE_LOOKUP_RESTLET_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ quote_number: quoteTranId })
    });

    console.log("[netsuite] lookupQuoteByTranId response status", { status: response.status });

    const responseText = await response.text();
    console.log("[netsuite] lookupQuoteByTranId raw response text", responseText);

    const json = parseJsonObject(responseText);
    console.log("[netsuite] lookupQuoteByTranId parsed JSON", json);

    if (!response.ok) {
      const failedResult = {
        success: false,
        message: typeof json.message === "string" ? json.message : `Quote lookup failed (${response.status})`
      } satisfies QuoteLookupResult;
      console.log("[netsuite] lookupQuoteByTranId normalized result", failedResult);
      return failedResult;
    }

    const normalized = normalizeQuoteLookupResponse(json);
    console.log("[netsuite] lookupQuoteByTranId normalized result", normalized);
    return normalized;
  } catch (error) {
    const err = error as Error;
    console.error("[netsuite] lookupQuoteByTranId error", {
      message: err?.message ?? String(error),
      stack: err?.stack
    });
    return {
      success: false,
      message: err?.message ?? "Unknown error during quote lookup"
    };
  }
}

export async function transformQuoteToSalesOrder(
  input: QuoteToSalesOrderTransformInput
): Promise<QuoteToSalesOrderTransformResult> {
  const hasTransformUrl = Boolean(config.NETSUITE_QUOTE_TO_SO_RESTLET_URL);
  const hasOAuthCredentials = Boolean(
    config.NETSUITE_ACCOUNT_ID &&
      config.NETSUITE_CONSUMER_KEY &&
      config.NETSUITE_CONSUMER_SECRET &&
      config.NETSUITE_TOKEN_ID &&
      config.NETSUITE_TOKEN_SECRET
  );

  if (!config.NETSUITE_QUOTE_TO_SO_RESTLET_URL) {
    throw new Error("NETSUITE_QUOTE_TO_SO_RESTLET_URL is not configured.");
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json"
  };

  const authHeader = buildNetSuiteAuthorizationHeader(config.NETSUITE_QUOTE_TO_SO_RESTLET_URL);
  if (authHeader) headers.authorization = authHeader;

  const body: Record<string, unknown> = {
    quote_internal_id: input.quoteInternalId
  };
  if (input.quoteTranId) body.quote_tranid = input.quoteTranId;
  if (input.poNumber) body.po_number = input.poNumber;
  if (input.memo) body.memo = input.memo;
  if (input.approvalStatusTarget) body.approval_status_target = input.approvalStatusTarget;
  if (input.agentActionRequestId) body.agent_action_request_id = input.agentActionRequestId;

  console.log("[netsuite] transformQuoteToSalesOrder start", {
    hasTransformUrl,
    hasOAuthCredentials,
    hasAuthHeader: Boolean(headers.authorization),
    quoteInternalId: input.quoteInternalId,
    quoteTranId: input.quoteTranId ?? null
  });
  console.log("[netsuite] transformQuoteToSalesOrder request body", body);

  const response = await fetch(config.NETSUITE_QUOTE_TO_SO_RESTLET_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  console.log("[netsuite] transformQuoteToSalesOrder response status", { status: response.status });
  const responseText = await response.text();
  console.log("[netsuite] transformQuoteToSalesOrder raw response text", responseText);

  const json = parseJsonObject(responseText);
  console.log("[netsuite] transformQuoteToSalesOrder parsed JSON", json);
  const normalized = normalizeQuoteToSoTransformResponse(json);
  console.log("[netsuite] transformQuoteToSalesOrder normalized result", normalized);

  if (response.status === 401) {
    throw new NetSuiteRestletError("NetSuite authentication failed for quote_to_so transform.", {
      code: "INVALID_LOGIN_ATTEMPT",
      details: normalized.details,
      httpStatus: 401
    });
  }

  if (!response.ok) {
    throw new NetSuiteRestletError(normalized.message ?? `Quote to SO transform failed (${response.status})`, {
      code: normalized.code,
      details: normalized.details,
      httpStatus: response.status
    });
  }

  if (!normalized.success) {
    throw new NetSuiteRestletError(normalized.message ?? "NetSuite quote_to_so transform returned success=false.", {
      code: normalized.code,
      details: normalized.details,
      httpStatus: response.status
    });
  }

  return normalized;
}

export async function getSalesOrderByInternalId(internalId: string): Promise<SalesOrderVerificationResult> {
  if (!config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL) {
    return {
      status: "verification_error",
      internalId,
      errorCode: "CONFIG_ERROR",
      safeMessage: "NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL is not configured."
    };
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json"
  };
  const authHeader = buildNetSuiteAuthorizationHeader(config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL);
  if (authHeader) headers.authorization = authHeader;

  console.log("[netsuite] getSalesOrderByInternalId start", {
    hasLookupUrl: Boolean(config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL),
    hasAuthHeader: Boolean(headers.authorization),
    internalId
  });

  try {
    const response = await fetch(config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ internalId })
    });

    console.log("[netsuite] getSalesOrderByInternalId response status", { status: response.status });
    const responseText = await response.text();
    console.log("[netsuite] getSalesOrderByInternalId raw response text", responseText);

    let raw: Record<string, unknown>;
    try {
      raw = parseJsonObject(responseText);
    } catch {
      return classifySalesOrderLookupFailure({ internalId, httpStatus: response.status, parseError: new Error("INVALID_JSON") });
    }

    console.log("[netsuite] getSalesOrderByInternalId parsed JSON", raw);

    const topCode = typeof raw.code === "string" ? raw.code : undefined;
    const nestedError = raw.error && typeof raw.error === "object" ? (raw.error as Record<string, unknown>) : undefined;
    const nestedCode = typeof nestedError?.code === "string" ? nestedError.code : undefined;
    const errorCode = topCode ?? nestedCode;
    const success = raw.success;
    if (!response.ok) return classifySalesOrderLookupFailure({ internalId, httpStatus: response.status, parsedBody: raw });
    if (errorCode === "INVALID_LOGIN_ATTEMPT" || errorCode === "CONFIG_ERROR" || errorCode === "MISSING_INTERNAL_ID") {
      return classifySalesOrderLookupFailure({ internalId, httpStatus: response.status, parsedBody: raw });
    }

    const orderRecord = (raw.salesOrder ?? raw.sales_order ?? raw.order ?? raw.result ?? raw) as Record<string, unknown>;
    const rawExists = raw.exists;
    const resolvedInternalId =
      typeof orderRecord.internalId === "string"
        ? orderRecord.internalId
        : typeof orderRecord.internal_id === "string"
          ? orderRecord.internal_id
          : typeof raw.id === "string"
            ? raw.id
            : typeof raw.internalId === "string"
              ? raw.internalId
              : typeof raw.internal_id === "string"
                ? raw.internal_id
                : internalId;
    const resolvedTranId =
      typeof orderRecord.tranId === "string"
        ? orderRecord.tranId
        : typeof orderRecord.tran_id === "string"
          ? orderRecord.tran_id
          : typeof raw.tranid === "string"
            ? raw.tranid
            : typeof raw.tranId === "string"
              ? raw.tranId
              : undefined;
    const exists = typeof rawExists === "boolean" ? rawExists : Boolean(orderRecord.internalId ?? orderRecord.internal_id ?? raw.id);

    if (success === false && isNetSuiteMissingRecordCode(errorCode)) {
      return classifySalesOrderLookupFailure({ internalId, httpStatus: response.status, parsedBody: raw });
    }

    if (exists) {
      return {
        status: "exists",
        internalId: String(resolvedInternalId),
        tranId: resolvedTranId,
        nsStatus: typeof orderRecord.status === "string" ? orderRecord.status : undefined
      };
    }

    if (success === false) return classifySalesOrderLookupFailure({ internalId, httpStatus: response.status, parsedBody: raw });
    return classifySalesOrderLookupFailure({ internalId, httpStatus: response.status, parsedBody: raw });
  } catch (error) {
    return classifySalesOrderLookupFailure({ internalId, fetchError: error });
  }
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "t" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "f" || normalized === "0" || normalized === "no") return false;
  }
  return undefined;
}

function normalizeOpenPoLookupResponse(raw: Record<string, unknown>): OpenPurchaseOrderLookupResult {
  const payload =
    raw.data && typeof raw.data === "object" && !Array.isArray(raw.data) ? (raw.data as Record<string, unknown>) : raw;
  const linesRaw = Array.isArray(payload.lines)
    ? payload.lines
    : Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.po_lines)
        ? payload.po_lines
        : [];
  const lines = linesRaw
    .filter((line): line is Record<string, unknown> => Boolean(line && typeof line === "object" && !Array.isArray(line)))
    .map((line) => ({
      lineId:
        typeof line.lineId === "string"
          ? line.lineId
          : typeof line.line_id === "string"
            ? line.line_id
            : typeof line.line === "string"
              ? line.line
              : undefined,
      lineUniqueKey:
        typeof line.lineUniqueKey === "string"
          ? line.lineUniqueKey
          : typeof line.lineuniquekey === "string"
            ? line.lineuniquekey
            : undefined,
      itemInternalId:
        typeof line.itemInternalId === "string"
          ? line.itemInternalId
          : typeof line.item_internal_id === "string"
            ? line.item_internal_id
            : undefined,
      itemNumber:
        typeof line.itemNumber === "string"
          ? line.itemNumber
          : typeof line.item_number === "string"
            ? line.item_number
            : typeof line.item === "string"
              ? line.item
              : undefined,
      description: typeof line.description === "string" ? line.description : undefined,
      quantity: asNumber(line.quantity),
      quantityReceived: asNumber(line.quantityReceived ?? line.quantity_received),
      quantityRemaining: asNumber(line.quantityRemaining ?? line.quantity_remaining),
      expectedReceiptDate:
        typeof line.expectedReceiptDate === "string"
          ? line.expectedReceiptDate
          : typeof line.expected_receipt_date === "string"
            ? line.expected_receipt_date
            : undefined,
      isClosed: asBoolean(line.isClosed ?? line.is_closed)
    }));

  return {
    success: raw.success === true || raw.status === true || payload.success === true,
    poInternalId:
      typeof payload.poInternalId === "string"
        ? payload.poInternalId
        : typeof payload.po_internal_id === "string"
          ? payload.po_internal_id
          : undefined,
    tranId:
      typeof payload.tranId === "string"
        ? payload.tranId
        : typeof payload.tranid === "string"
          ? payload.tranid
          : typeof payload.poNumber === "string"
            ? payload.poNumber
            : typeof payload.po_number === "string"
              ? payload.po_number
              : undefined,
    vendorName:
      typeof payload.vendorName === "string"
        ? payload.vendorName
        : typeof payload.vendor_name === "string"
          ? payload.vendor_name
          : undefined,
    status:
      typeof payload.status === "string"
        ? payload.status
        : typeof raw.status === "string"
          ? raw.status
          : undefined,
    lines,
    code:
      typeof payload.code === "string"
        ? payload.code
        : typeof raw.code === "string"
          ? raw.code
          : undefined,
    message:
      typeof raw.message === "string"
        ? raw.message
        : typeof payload.message === "string"
          ? payload.message
          : undefined,
    details: payload.details ?? raw.details
  };
}

export async function lookupOpenPurchaseOrder(input: { po: string }): Promise<OpenPurchaseOrderLookupResult> {
  const po = input.po.trim();
  if (!config.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL) {
    return {
      success: false,
      code: "CONFIG_ERROR",
      message: "NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL is not configured.",
      lines: []
    };
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json"
  };
  const authHeader = buildNetSuiteAuthorizationHeader(config.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL);
  if (authHeader) headers.authorization = authHeader;

  console.log("[netsuite] lookupOpenPurchaseOrder start", {
    hasLookupUrl: Boolean(config.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL),
    hasAuthHeader: Boolean(headers.authorization),
    po
  });

  try {
    const response = await fetch(config.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ po })
    });

    console.log("[netsuite] lookupOpenPurchaseOrder response status", { status: response.status });
    const responseText = await response.text();
    console.log("[netsuite] lookupOpenPurchaseOrder raw response text", responseText);
    const raw = parseJsonObject(responseText);
    console.log("[netsuite] lookupOpenPurchaseOrder parsed JSON", raw);
    const normalized = normalizeOpenPoLookupResponse(raw);
    console.log("[netsuite] lookupOpenPurchaseOrder normalized result", {
      success: normalized.success,
      poInternalId: normalized.poInternalId,
      tranId: normalized.tranId,
      status: normalized.status,
      lineCount: normalized.lines.length,
      code: normalized.code
    });

    if (!response.ok) {
      return {
        ...normalized,
        success: false,
        code: normalized.code ?? `HTTP_${response.status}`,
        message: normalized.message ?? `Open PO lookup failed (${response.status})`
      };
    }

    return normalized;
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      code: "LOOKUP_ERROR",
      message: err?.message ?? "Unknown error while looking up open PO.",
      lines: []
    };
  }
}

export async function updatePurchaseOrderEta(input: UpdatePurchaseOrderEtaInput): Promise<UpdatePurchaseOrderEtaResult> {
  if (!config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL) {
    return {
      success: false,
      code: "CONFIG_ERROR",
      message: "NETSUITE_PO_ETA_UPDATE_RESTLET_URL is not configured."
    };
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json"
  };
  const authHeader = buildNetSuiteAuthorizationHeader(config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL);
  if (authHeader) headers.authorization = authHeader;

  const body: Record<string, unknown> = {
    po: input.po,
    etaDate: input.etaDate,
    etaConfidence: input.etaConfidence ?? "MED",
    trackingNumber: input.trackingNumber ?? null,
    etaSource: input.etaSource ?? "email",
    etaNotes: input.etaNotes ?? "",
    updateOwner: input.updateOwner ?? "JanveyOS"
  };
  if (input.items && input.items.length > 0) body.items = input.items;

  console.log("[netsuite] updatePurchaseOrderEta start", {
    hasRestletUrl: Boolean(config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL),
    hasAuthHeader: Boolean(headers.authorization),
    po: input.po,
    etaDate: input.etaDate,
    etaConfidence: input.etaConfidence ?? "MED",
    hasTracking: Boolean(input.trackingNumber),
    itemCount: input.items?.length ?? 0
  });

  try {
    const response = await fetch(config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    const rawText = await response.text();
    console.log("[netsuite] updatePurchaseOrderEta response status", { status: response.status });
    console.log("[netsuite] updatePurchaseOrderEta raw response text", rawText);

    const raw = parseJsonObject(rawText);
    const normalized: UpdatePurchaseOrderEtaResult = {
      success: raw.success === true,
      code: typeof raw.code === "string" ? raw.code : undefined,
      message: typeof raw.message === "string" ? raw.message : undefined,
      details: raw.details,
      poInternalId:
        typeof raw.poInternalId === "string"
          ? raw.poInternalId
          : typeof raw.po_internal_id === "string"
            ? raw.po_internal_id
            : undefined,
      poNumber:
        typeof raw.poNumber === "string"
          ? raw.poNumber
          : typeof raw.po_number === "string"
            ? raw.po_number
            : undefined,
      linesUpdated:
        typeof raw.linesUpdated === "number"
          ? raw.linesUpdated
          : typeof raw.lines_updated === "number"
            ? raw.lines_updated
            : undefined
    };

    if (!response.ok) {
      return {
        ...normalized,
        success: false,
        code: normalized.code ?? `HTTP_${response.status}`,
        message: normalized.message ?? `PO ETA update failed (${response.status})`
      };
    }

    return normalized;
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      code: "LOOKUP_ERROR",
      message: err?.message ?? "Unknown NetSuite PO ETA update error."
    };
  }
}
