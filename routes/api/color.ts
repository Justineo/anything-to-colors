import { defineHandler } from "void";
import { env } from "void/env";
import { colorRequest, readColorResponse } from "../../server/palette";
import { clientAccess, admissionResponse } from "../../server/access";
import { requestTiming } from "../../server/timing";
import { maxTextLength } from "../../shared/limits.ts";

export const POST = defineHandler(async (c) => {
  const began = performance.now();
  const body = await c.req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > maxTextLength) {
    c.header("Cache-Control", "no-store");
    return c.json({ error: `Enter 1–${maxTextLength} characters.` }, 400);
  }
  const headers = await clientAccess(c);
  const authorized = performance.now();
  if (headers instanceof Response) return headers;

  try {
    headers.set("Content-Type", "application/json");
    if (!env.COLOR_RELAY_URL) headers.set("Authorization", `Bearer ${env.OPENAI_API_KEY}`);
    const response = await fetch(env.COLOR_RELAY_URL || "https://api.openai.com/v1/responses", {
      method: "POST",
      headers,
      body: JSON.stringify(colorRequest(text)),
      signal: AbortSignal.timeout(18_000),
    });
    c.header("Server-Timing", requestTiming(response, began, authorized));
    const limited = admissionResponse(response);
    if (limited) return limited;
    if (!response.ok) {
      console.error("Color request failed:", response.status);
      return c.json({ error: "The palette service is unavailable. Please try again later." }, 502);
    }
    const palette = readColorResponse(await response.json());
    if (!palette) return c.json({ error: "No palette was found. Please try again." }, 502);
    return c.json(palette);
  } catch {
    return c.json({ error: "The palette request timed out. Please try again." }, 504);
  }
});
