import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../shared/config.js";
import { assertQuoteToSoDevResetAllowed } from "./dev-reset.js";

test("dev reset helper is blocked in production", () => {
  const prev = config.NODE_ENV;
  config.NODE_ENV = "production";
  try {
    assert.throws(() => assertQuoteToSoDevResetAllowed(), /blocked in production/i);
  } finally {
    config.NODE_ENV = prev;
  }
});
