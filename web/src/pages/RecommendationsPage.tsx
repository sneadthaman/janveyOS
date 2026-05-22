import { useEffect, useState } from "react";
import { getRecentRecommendations, submitRecommendationFeedback } from "../api";
import type { RecommendationLog } from "../types";

export function RecommendationsPage() {
  const [rows, setRows] = useState<RecommendationLog[]>([]);
  const [error, setError] = useState("");
  const [freeText, setFreeText] = useState<Record<string, string>>({});

  async function load() {
    setRows(await getRecentRecommendations());
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load recommendations"));
  }, []);

  return (
    <section>
      <h2>Recent Recommendations</h2>
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Customer Segment</th>
            <th>Input Summary</th>
            <th>Best Fit</th>
            <th>Alt</th>
            <th>Margin/Pricing</th>
            <th>Reasoning</th>
            <th>Feedback</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const output = row.recommendation_json?.output;
            const input = row.recommendation_json?.input ?? {};
            const best = output?.best_fit_product;
            const alt = output?.value_alternative;
            const segment = String(input.customer_segment ?? input.segment ?? "-");
            const summary = String(row.request_text ?? "");
            const reasoning = [
              ...(output?.why_it_fits ?? []),
              ...(output?.how_to_sell ?? [])
            ]
              .filter(Boolean)
              .join(" | ");
            const knowledgeUsed = output?.knowledge_used ?? [];
            return (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td>{segment}</td>
                <td>{summary}</td>
                <td>{best ? `${best.product_name} (${best.sku})` : "-"}</td>
                <td>{alt ? `${alt.product_name} (${alt.sku})` : "-"}</td>
                <td>
                  {best
                    ? `Best: $${best.price ?? "-"}, ${(best.margin_percent * 100).toFixed(2)}% | Alt: ${
                        alt?.price ?? "-"
                      }, ${alt ? `${(alt.margin_percent * 100).toFixed(2)}%` : "-"}`
                    : "-"}
                </td>
                <td>
                  <div>{reasoning || "-"}</div>
                  {knowledgeUsed.length > 0 ? (
                    <div className="meta">
                      knowledge_used:{" "}
                      {knowledgeUsed
                        .map((k) => `${k.title} [${k.category}]${k.matched_product_sku ? ` (${k.matched_product_sku})` : ""}`)
                        .join(" | ")}
                    </div>
                  ) : (
                    <div className="meta">knowledge_used: none</div>
                  )}
                </td>
                <td>
                  <div className="actions">
                    <button
                      onClick={() =>
                        void submitRecommendationFeedback(row.id, {
                          feedback: "good_recommendation",
                          created_by: "manager",
                          free_text_feedback: freeText[row.id] || undefined
                        }).catch((e) =>
                          setError(e instanceof Error ? e.message : "Feedback failed")
                        )
                      }
                    >
                      Good Recommendation
                    </button>
                    <button
                      onClick={() =>
                        void submitRecommendationFeedback(row.id, {
                          feedback: "bad_recommendation",
                          created_by: "manager",
                          free_text_feedback: freeText[row.id] || undefined
                        }).catch((e) =>
                          setError(e instanceof Error ? e.message : "Feedback failed")
                        )
                      }
                    >
                      Bad Recommendation
                    </button>
                    <button
                      onClick={() =>
                        void submitRecommendationFeedback(row.id, {
                          feedback: "needs_correction",
                          created_by: "manager",
                          free_text_feedback: freeText[row.id] || undefined
                        }).catch((e) => setError(e instanceof Error ? e.message : "Feedback failed"))
                      }
                    >
                      Needs Correction
                    </button>
                    <button
                      onClick={() =>
                        void submitRecommendationFeedback(row.id, {
                          feedback: "wrong_product",
                          created_by: "manager",
                          free_text_feedback: freeText[row.id] || undefined
                        }).catch((e) => setError(e instanceof Error ? e.message : "Feedback failed"))
                      }
                    >
                      Wrong Product
                    </button>
                    <button
                      onClick={() =>
                        void submitRecommendationFeedback(row.id, {
                          feedback: "bad_tone",
                          created_by: "manager",
                          free_text_feedback: freeText[row.id] || undefined
                        }).catch((e) => setError(e instanceof Error ? e.message : "Feedback failed"))
                      }
                    >
                      Bad Tone
                    </button>
                    <button
                      onClick={() =>
                        void submitRecommendationFeedback(row.id, {
                          feedback: "missing_context",
                          created_by: "manager",
                          free_text_feedback: freeText[row.id] || undefined
                        }).catch((e) => setError(e instanceof Error ? e.message : "Feedback failed"))
                      }
                    >
                      Missing Context
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    placeholder="Optional free-text feedback"
                    value={freeText[row.id] ?? ""}
                    onChange={(e) => setFreeText((prev) => ({ ...prev, [row.id]: e.target.value }))}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
