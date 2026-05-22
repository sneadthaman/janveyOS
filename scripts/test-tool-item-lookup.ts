import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const baseUrl = process.env.JANVEY_OS_API_BASE_URL ?? "http://localhost:3000";
  const secret = process.env.AGENT_SHARED_SECRET;

  const res = await fetch(`${baseUrl}/api/tools/item-lookup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-agent-secret": secret } : {})
    },
    body: JSON.stringify({ query: "DIV 95892221", requested_by: "test-agent", source: "openclaw" })
  });
  const body = await res.json();
  console.log("response", JSON.stringify(body, null, 2));

  const client = createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");
  const { data, error } = await client
    .from("agent_tool_calls")
    .select("id, tool_name, status, created_at")
    .eq("tool_name", "item_lookup")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error(`DB row missing: ${error?.message ?? "none"}`);
  console.log("db_row", JSON.stringify(data, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
