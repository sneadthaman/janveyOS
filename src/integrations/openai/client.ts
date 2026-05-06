import OpenAI from "openai";
import { config } from "../../shared/config.js";

export const openaiClient = config.OPENAI_API_KEY
  ? new OpenAI({ apiKey: config.OPENAI_API_KEY })
  : null;
