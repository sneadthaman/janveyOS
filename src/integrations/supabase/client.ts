import { createClient } from "@supabase/supabase-js";
import { config } from "../../shared/config.js";

export const supabaseAdminClient =
  config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
    : null;
