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
  AI_MODEL_SALES_RECOMMENDATION: optionalEnvString,
  AI_MODEL_SLACK_SIMPLE_REPLY: optionalEnvString,
  AI_MODEL_FILE_EXTRACTION: optionalEnvString,
  AI_MODEL_KNOWLEDGE_SUMMARY: optionalEnvString,
  AI_MODEL_EMAIL_DRAFT: optionalEnvString,
  AI_MODEL_FALLBACK: optionalEnvString,
  AI_REASONING_EFFORT_SALES_RECOMMENDATION: optionalEnvString,
  AI_REASONING_EFFORT_SLACK_SIMPLE_REPLY: optionalEnvString,
  AI_REASONING_EFFORT_FILE_EXTRACTION: optionalEnvString,
  AI_REASONING_EFFORT_KNOWLEDGE_SUMMARY: optionalEnvString,
  AI_REASONING_EFFORT_EMAIL_DRAFT: optionalEnvString,
  AI_REASONING_EFFORT_FALLBACK: optionalEnvString
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid environment config: ${issues}`);
}

export const config = parsed.data;
