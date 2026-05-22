const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3000";

async function run() {
  const uploadsBeforeRes = await fetch(`${API_BASE}/api/uploads`);
  if (!uploadsBeforeRes.ok) throw new Error(`Failed to load uploads: ${uploadsBeforeRes.status}`);
  const beforeJson = (await uploadsBeforeRes.json()) as { uploads: Array<Record<string, unknown>> };
  const uploads = beforeJson.uploads ?? [];

  const targetId =
    process.env.UPLOAD_ID ??
    String(
      uploads.find(
        (u) => Number(u.parsed_rows ?? 0) > 0 && Number(u.parsed_pending_count ?? u.pending_approval_count ?? 0) > 0
      )?.id ?? ""
    );

  if (!targetId) {
    console.log("No upload with pending parsed rows found. Nothing to approve.");
    return;
  }

  console.log("Target upload:", targetId);
  const approveRes = await fetch(`${API_BASE}/api/uploads/${targetId}/approve`, { method: "POST" });
  const approveJson = await approveRes.json();
  console.log("Approve response:", JSON.stringify(approveJson, null, 2));

  const uploadsAfterRes = await fetch(`${API_BASE}/api/uploads`);
  if (!uploadsAfterRes.ok) throw new Error(`Failed to load uploads after approval: ${uploadsAfterRes.status}`);
  const afterJson = (await uploadsAfterRes.json()) as { uploads: Array<Record<string, unknown>> };
  const target = (afterJson.uploads ?? []).find((u) => String(u.id) === targetId);

  if (!target) throw new Error("Approved upload not found in listing after approval.");

  console.log("Dashboard count snapshot after approval:");
  console.log(
    JSON.stringify(
      {
        id: target.id,
        pending_approval_count: target.pending_approval_count,
        approved_count: target.approved_count,
        parsed_pending_count: target.parsed_pending_count,
        parsed_approved_count: target.parsed_approved_count,
        products_pending_count: target.products_pending_count,
        products_approved_count: target.products_approved_count,
        pricing_pending_count: target.pricing_pending_count,
        pricing_approved_count: target.pricing_approved_count,
        knowledge_pending_count: target.knowledge_pending_count,
        knowledge_approved_count: target.knowledge_approved_count
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
