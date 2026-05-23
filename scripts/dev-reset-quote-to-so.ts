import { resetQuoteToSoLocalState } from "../src/features/quote-to-so/dev-reset.js";

async function main() {
  const quoteRef = process.argv[2];
  if (!quoteRef) {
    throw new Error("Usage: npm run dev:reset-quote-to-so -- <QUOTE_TRANID_OR_INTERNAL_ID>");
  }

  const result = await resetQuoteToSoLocalState(quoteRef);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
