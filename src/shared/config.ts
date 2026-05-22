import "dotenv/config";
import { z } from "zod";

const optionalEnvString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().min(1).optional());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  OPENAI_API_KEY: optionalEnvString,
  SUPABASE_URL: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }, z.string().url().optional()),
  SUPABASE_SERVICE_ROLE_KEY: optionalEnvString,
  SUPABASE_ANON_KEY: optionalEnvString,
  SLACK_BOT_TOKEN: optionalEnvString,
  SLACK_SIGNING_SECRET: optionalEnvString,
  SLACK_APP_TOKEN: optionalEnvString,
  JANVEY_OS_API_BASE_URL: optionalEnvString,
  AGENT_SHARED_SECRET: optionalEnvString,
  EXECUTION_WORKER_ENABLED: optionalEnvString,
  EXECUTION_WORKER_INTERVAL_MS: z.coerce.number().optional(),
  NETSUITE_EXECUTION_MODE: optionalEnvString,
  NETSUITE_LIVE_QUOTE_TO_SO_ENABLED: z.enum(["true", "false"]).default("false"),
  NETSUITE_QUOTE_LOOKUP_RESTLET_URL: optionalEnvString,
  NETSUITE_QUOTE_TO_SO_RESTLET_URL: optionalEnvString,
  NETSUITE_ACCOUNT_ID: optionalEnvString,
  NETSUITE_CONSUMER_KEY: optionalEnvString,
  NETSUITE_CONSUMER_SECRET: optionalEnvString,
  NETSUITE_TOKEN_ID: optionalEnvString,
  NETSUITE_TOKEN_SECRET: optionalEnvString,
  NETSUITE_RESTLET_AUTH_HEADER: optionalEnvString,
  AI_MODEL_SALES_RECOMMENDATION: optionalEnvString,
  AI_MODEL_SLACK_SIMPLE_REPLY: optionalEnvString,
  AI_MODEL_FILE_EXTRACTION: optionalEnvString,
  AI_MODEL_KNOWLEDGE_SUMMARY: optionalEnvString,
  AI_MODEL_EMAIL_DRAFT: optionalEnvString,
  AI_MODEL_STRUCTURED_KNOWLEDGE_EXTRACTION: optionalEnvString,
  AI_MODEL_FALLBACK: optionalEnvString,
  AI_REASONING_EFFORT_SALES_RECOMMENDATION: optionalEnvString,
  AI_REASONING_EFFORT_SLACK_SIMPLE_REPLY: optionalEnvString,
  AI_REASONING_EFFORT_FILE_EXTRACTION: optionalEnvString,
  AI_REASONING_EFFORT_KNOWLEDGE_SUMMARY: optionalEnvString,
  AI_REASONING_EFFORT_EMAIL_DRAFT: optionalEnvString,
  AI_REASONING_EFFORT_STRUCTURED_KNOWLEDGE_EXTRACTION: optionalEnvString,
  AI_REASONING_EFFORT_FALLBACK: optionalEnvString
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid environment config: ${issues}`);
}

export const config = parsed.data;
