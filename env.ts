import { defineEnv, string, url } from "void/env";

export default defineEnv({
  OPENAI_API_KEY: string().optional(),
  COLOR_RELAY_URL: url().optional(),
  COLOR_RELAY_TOKEN: string().optional(),
  CLIENT_SIGNING_KEY: string().optional(),
  TURNSTILE_SITE_KEY: string().optional(),
  TURNSTILE_SECRET_KEY: string().optional(),
});
