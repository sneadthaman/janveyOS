import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../shared/config.js";
import { runAiTask } from "./ai-client.js";

test("runAiTask omits reasoning.effort for models without reasoning support", async () => {
  const prevModel = config.AI_MODEL_FALLBACK;
  const prevReasoning = config.AI_REASONING_EFFORT_FALLBACK;

  config.AI_MODEL_FALLBACK = "gpt-4.1-mini";
  config.AI_REASONING_EFFORT_FALLBACK = "medium";

  let capturedParams: Record<string, unknown> | null = null;

  try {
    const result = await runAiTask(
      "fallback",
      "hello",
      {},
      {
        client: {
          responses: {
            create: async (params) => {
              capturedParams = params as unknown as Record<string, unknown>;
              return { output_text: "ok", id: "resp_123" };
            }
          }
        }
      }
    );

    assert.equal(result.used_fallback, false);
    assert.equal(result.text, "ok");
    assert.ok(capturedParams);
    assert.equal("reasoning" in (capturedParams ?? {}), false);
  } finally {
    config.AI_MODEL_FALLBACK = prevModel;
    config.AI_REASONING_EFFORT_FALLBACK = prevReasoning;
  }
});
