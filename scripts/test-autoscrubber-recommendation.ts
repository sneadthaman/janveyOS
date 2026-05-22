const BASE_URL = process.env.JANVEY_API_URL ?? "http://localhost:3000";

async function main() {
  const payload = {
    customer_segment: "school",
    floor_type: "VCT",
    square_footage: 40000,
    cleaning_frequency: "daily",
    battery_preference: "battery"
  };

  const response = await fetch(`${BASE_URL}/api/recommendations/autoscrubber`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    console.error("Autoscrubber recommendation test failed:", json);
    process.exit(1);
  }
  console.log("Autoscrubber recommendation test passed");
  console.log(
    JSON.stringify(
      {
        recommendation_id: json.recommendation_id,
        no_approved_pricing: json.no_approved_pricing ?? false,
        best_fit_product: json.best_fit_product ?? null,
        value_alternative: json.value_alternative ?? null,
        confidence_score: json.confidence_score ?? null
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("test:autoscrubber-recommendation crashed", error);
  process.exit(1);
});
