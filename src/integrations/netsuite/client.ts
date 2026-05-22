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
