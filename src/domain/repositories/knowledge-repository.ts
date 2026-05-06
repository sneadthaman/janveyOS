import { supabaseAdminClient } from "../../integrations/supabase/client.js";
import { logger } from "../../shared/logger.js";

export interface StrategyRule {
  id: string;
  name: string;
  ruleText: string;
}

export interface VendorPriority {
  vendor: "Nilfisk" | "Taski" | "Triple-S";
  priorityRank: number;
}

export async function fetchStrategyRules(): Promise<StrategyRule[]> {
  if (!supabaseAdminClient) return [];
  const { data, error } = await supabaseAdminClient
    .from("strategy_rules")
    .select("id,name,rule_text")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) {
    logger.warn("Failed to fetch strategy rules", error);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    ruleText: row.rule_text as string
  }));
}

export async function fetchVendorPriority(): Promise<VendorPriority[]> {
  if (!supabaseAdminClient) return [];
  const { data, error } = await supabaseAdminClient
    .from("vendor_priority")
    .select("vendor,priority_rank")
    .order("priority_rank", { ascending: true });
  if (error) {
    logger.warn("Failed to fetch vendor priority", error);
    return [];
  }
  return (data ?? []).map((row) => ({
    vendor: row.vendor as VendorPriority["vendor"],
    priorityRank: row.priority_rank as number
  }));
}
