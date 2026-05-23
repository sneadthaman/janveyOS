import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../shared/config.js";
import { getSalesOrderByInternalId } from "./client.js";

test("missing sales order lookup URL returns verification_error", async () => {
  const prev = config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL;
  config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = undefined;
  try {
    const result = await getSalesOrderByInternalId("9001");
    assert.equal(result.status, "verification_error");
  } finally {
    config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = prev;
  }
});

test("normalizes exists shapes", async () => {
  const prev = config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL;
  const originalFetch = globalThis.fetch;
  config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = "https://example.com/so-lookup";

  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    const body =
      call === 1
        ? { success: true, exists: true, internalId: "123", tranId: "SO307399" }
        : { exists: true, id: "123", tranid: "SO307399" };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body)
    } as Response;
  }) as typeof fetch;

  try {
    const r1 = await getSalesOrderByInternalId("123");
    const r2 = await getSalesOrderByInternalId("123");
    assert.equal(r1.status, "exists");
    assert.equal(r2.status, "exists");
  } finally {
    config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = prev;
    globalThis.fetch = originalFetch;
  }
});

test("normalizes missing and verification_error shapes conservatively", async () => {
  const prev = config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL;
  const originalFetch = globalThis.fetch;
  config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = "https://example.com/so-lookup";

  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    const body =
      call === 1
        ? { success: false, code: "NOT_FOUND" }
        : call === 2
          ? { error: { code: "RCRD_DSNT_EXIST" } }
          : call === 3
            ? { success: false, code: "INVALID_KEY_OR_REF" }
            : call === 4
              ? { success: false, code: "MISSING_INTERNAL_ID" }
              : { success: false, code: "INVALID_LOGIN_ATTEMPT" };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body)
    } as Response;
  }) as typeof fetch;

  try {
    const verifyErr1 = await getSalesOrderByInternalId("123");
    const missing2 = await getSalesOrderByInternalId("123");
    const missing3 = await getSalesOrderByInternalId("123");
    const verifyErr2 = await getSalesOrderByInternalId("123");
    const verifyErr3 = await getSalesOrderByInternalId("123");
    assert.equal(verifyErr1.status, "verification_error");
    assert.equal(missing2.status, "missing");
    assert.equal(missing3.status, "missing");
    assert.equal(verifyErr2.status, "verification_error");
    assert.equal(verifyErr3.status, "verification_error");
  } finally {
    config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = prev;
    globalThis.fetch = originalFetch;
  }
});

test("http 404 with not-found body returns missing", async () => {
  const prev = config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL;
  const originalFetch = globalThis.fetch;
  config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = "https://example.com/so-lookup";

  globalThis.fetch = (async () => {
    return {
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ success: false, error: { code: "RECORD_NOT_FOUND", message: "Record does not exist" } })
    } as Response;
  }) as typeof fetch;

  try {
    const result = await getSalesOrderByInternalId("123");
    assert.equal(result.status, "missing");
  } finally {
    config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = prev;
    globalThis.fetch = originalFetch;
  }
});

test("auth failure returns verification_error", async () => {
  const prev = config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL;
  const originalFetch = globalThis.fetch;
  config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = "https://example.com/so-lookup";

  globalThis.fetch = (async () => {
    return {
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ success: false, code: "INVALID_LOGIN_ATTEMPT" })
    } as Response;
  }) as typeof fetch;

  try {
    const result = await getSalesOrderByInternalId("123");
    assert.equal(result.status, "verification_error");
  } finally {
    config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = prev;
    globalThis.fetch = originalFetch;
  }
});

test("http 404 html response returns verification_error", async () => {
  const prev = config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL;
  const originalFetch = globalThis.fetch;
  config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = "https://example.com/bad-endpoint";

  globalThis.fetch = (async () => {
    return {
      ok: false,
      status: 404,
      text: async () => "<html>Page not found</html>"
    } as Response;
  }) as typeof fetch;

  try {
    const result = await getSalesOrderByInternalId("123");
    assert.equal(result.status, "verification_error");
  } finally {
    config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = prev;
    globalThis.fetch = originalFetch;
  }
});

test("malformed JSON response returns verification_error", async () => {
  const prev = config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL;
  const originalFetch = globalThis.fetch;
  config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = "https://example.com/so-lookup";

  globalThis.fetch = (async () => {
    return {
      ok: true,
      status: 200,
      text: async () => "{this-is-not-json"
    } as Response;
  }) as typeof fetch;

  try {
    const result = await getSalesOrderByInternalId("123");
    assert.equal(result.status, "verification_error");
  } finally {
    config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = prev;
    globalThis.fetch = originalFetch;
  }
});

test("bad lookup URL/fetch error returns verification_error", async () => {
  const prev = config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL;
  const originalFetch = globalThis.fetch;
  config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = "https://bad.local/so-lookup";

  globalThis.fetch = (async () => {
    throw new Error("getaddrinfo ENOTFOUND bad.local");
  }) as typeof fetch;

  try {
    const result = await getSalesOrderByInternalId("123");
    assert.equal(result.status, "verification_error");
  } finally {
    config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = prev;
    globalThis.fetch = originalFetch;
  }
});

test("lookup request sends { internalId } body shape", async () => {
  const prev = config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL;
  const originalFetch = globalThis.fetch;
  config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = "https://example.com/so-lookup";

  let requestBody: unknown = null;
  globalThis.fetch = (async (_url, init) => {
    requestBody = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, exists: true, internalId: "175276", tranId: "SOX" })
    } as Response;
  }) as typeof fetch;

  try {
    const result = await getSalesOrderByInternalId("175276");
    assert.equal(result.status, "exists");
    assert.deepEqual(requestBody, { internalId: "175276" });
  } finally {
    config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL = prev;
    globalThis.fetch = originalFetch;
  }
});
