export type QuoteToSoUserResult =
  | {
      status: "started";
      quoteInternalId: string;
      quoteTranId?: string;
    }
  | {
      status: "already_running";
      quoteInternalId: string;
      quoteTranId?: string;
    }
  | {
      status: "already_completed";
      quoteInternalId: string;
      quoteTranId?: string;
      salesOrderInternalId: string;
      salesOrderTranId?: string;
    }
  | {
      status: "completed";
      quoteInternalId: string;
      quoteTranId?: string;
      salesOrderInternalId: string;
      salesOrderTranId?: string;
    }
  | {
      status: "failed";
      quoteInternalId: string;
      quoteTranId?: string;
      safeErrorMessage: string;
    };

function displayQuoteId(input: { quoteTranId?: string; quoteInternalId: string }) {
  return input.quoteTranId || input.quoteInternalId;
}

export function toQuoteToSoSlackMessage(result: QuoteToSoUserResult): string {
  const quoteDisplay = displayQuoteId(result);

  if (result.status === "started") {
    return `⏳ Converting Quote ${quoteDisplay} to Sales Order...\n\nI’ll post the Sales Order result here when NetSuite finishes.`;
  }

  if (result.status === "already_running") {
    return (
      "⏳ This Quote is already being converted.\n\n" +
      `Quote: ${quoteDisplay}\n` +
      "Status: Already running\n\n" +
      "No duplicate Sales Order will be created."
    );
  }

  if (result.status === "already_completed") {
    return (
      "✅ This Quote was already converted to a Sales Order.\n\n" +
      `Quote: ${quoteDisplay}\n` +
      `Sales Order: ${result.salesOrderTranId ?? result.salesOrderInternalId}\n\n` +
      "No duplicate Sales Order was created."
    );
  }

  if (result.status === "completed") {
    return (
      "✅ Quote to Sales Order completed.\n\n" +
      `Quote: ${quoteDisplay}\n` +
      `Sales Order: ${result.salesOrderTranId ?? result.salesOrderInternalId}`
    );
  }

  return (
    "❌ Quote to Sales Order failed.\n\n" +
    `Quote: ${quoteDisplay}\n` +
    `Reason: ${result.safeErrorMessage}\n\n` +
    "No duplicate Sales Order was created. You can retry after fixing the issue."
  );
}
