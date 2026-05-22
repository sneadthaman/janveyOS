import { debugExtractQuoteToSoIntent } from "../src/domain/services/slack/quote-to-so-conversation.js";

const samples = [
  "convert quote EST7883",
  "convert quote 7883",
  "create SO from EST7883",
  "turn EST7883 into a sales order"
];

for (const sample of samples) {
  const result = debugExtractQuoteToSoIntent(sample);
  console.log(JSON.stringify(result));
}
