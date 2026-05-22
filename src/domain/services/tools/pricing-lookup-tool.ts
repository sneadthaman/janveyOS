import { createAgentToolCall } from "../../repositories/agent-log-repository.js";

export async function runPricingLookupTool(input: {
  sku: string;
  customer: string;
  requested_by?: string;
  source?: string;
}) {
  const startedAt = Date.now();
  try {
    const output = {
      status: true,
      tool: "pricing_lookup",
      data: {
        sku: input.sku,
        customer: input.customer,
        sell_price: null,
        cost: null,
        margin_percent: null,
        notes: "Pricing lookup scaffold working. NetSuite integration pending."
      },
      confidence: "low",
      source_trail: ["mock_data"]
    } as const;

    await createAgentToolCall({
      requestedBy: input.requested_by,
      source: input.source,
      toolName: "pricing_lookup",
      inputJson: input,
      outputJson: output,
      status: "completed",
      latencyMs: Date.now() - startedAt
    });

    return output;
  } catch {
    const output = { status: false, tool: "pricing_lookup", error: "Pricing lookup failed." } as const;
    try {
      await createAgentToolCall({
        requestedBy: input.requested_by,
        source: input.source,
        toolName: "pricing_lookup",
        inputJson: input,
        outputJson: output,
        status: "failed",
        errorMessage: "Pricing lookup failure",
        latencyMs: Date.now() - startedAt
      });
    } catch {}
    return output;
  }
}
