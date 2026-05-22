const BASE_URL = process.env.JANVEY_API_URL ?? "http://localhost:3000";
const ingestUrl = process.env.INGEST_URL;

async function main() {
  if (!ingestUrl) {
    console.error("Set INGEST_URL before running test:ingest-url");
    process.exit(1);
  }
  const response = await fetch(`${BASE_URL}/api/ingest/url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: ingestUrl,
      vendor: "Nilfisk",
      category: "autoscrubber",
      notes: "URL ingestion test"
    })
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    console.error("URL ingestion test failed:", json);
    process.exit(1);
  }
  console.log("URL ingestion test passed");
  console.log(JSON.stringify(json, null, 2));
}

main().catch((error) => {
  console.error("test:ingest-url crashed", error);
  process.exit(1);
});
