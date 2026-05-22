import type { ToolName } from "./types.js";

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export async function executeSafeTool(tool: ToolName, payload: Record<string, unknown>) {
  if (tool === "get_customer_profile") {
    return {
      customer_id: asString(payload.customer_id, "unknown"),
      account_name: asString(payload.account_name, "Unknown Account"),
      status: "active",
      open_quotes: 2,
      ar_balance_usd: 0,
      source: "janvey_stub"
    };
  }

  if (tool === "draft_vendor_email") {
    const vendor = asString(payload.vendor, "vendor");
    const topic = asString(payload.topic, "follow-up");
    return {
      subject: `Janvey: ${topic}`,
      body: `Hi ${vendor},\n\nPlease review the requested update regarding ${topic}.\n\nThanks,\nJanvey Team`,
      send_status: "draft_only"
    };
  }

  if (tool === "create_netsuite_quote") {
    return {
      quote_id: `NSQ-${Date.now()}`,
      status: "created_in_stub",
      note: "NetSuite direct writes are mocked in MVP boundary mode."
    };
  }

  throw new Error(`Unsupported tool: ${tool}`);
}
