import { createAgentToolCall } from "../../repositories/agent-log-repository.js";

export async function runItemLookupTool(input: {
  query: string;
  requested_by?: string;
  source?: string;
}) {
  const startedAt = Date.now();
  try {
    const output = {
      status: true,
      tool: "item_lookup",
      data: {
        sku: input.query,
        item_name: "Mock item",
        vendor: "Mock vendor",
        on_hand: null,
        available: null,
        last_purchase_price: null,
        notes: "Item lookup scaffold working. NetSuite integration pending."
      },
      confidence: "low",
      source_trail: ["mock_data"]
    } as const;

    await createAgentToolCall({
      requestedBy: input.requested_by,
      source: input.source,
      toolName: "item_lookup",
      inputJson: input,
      outputJson: output,
      status: "completed",
      latencyMs: Date.now() - startedAt
    });

    return output;
  } catch {
    const output = {
      status: false,
      tool: "item_lookup",
      error: "Item lookup failed."
    } as const;

    try {
      await createAgentToolCall({
        requestedBy: input.requested_by,
        source: input.source,
        toolName: "item_lookup",
        inputJson: input,
        outputJson: output,
        status: "failed",
        errorMessage: "Item lookup failure",
        latencyMs: Date.now() - startedAt
      });
    } catch {}

    return output;
  }
}
