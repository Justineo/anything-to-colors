import { defineHandler } from "void";
import { env } from "void/env";
import { checkOrigin, localDevelopment, visitorHeaders } from "../../server/access";
import { clientCookie, issueClient, readClient } from "../../server/identity";

export const POST = defineHandler(async (c) => {
  c.header("Cache-Control", "no-store");
  if (!checkOrigin(c.req.raw))
    return c.json({ error: "Requests must originate from this website." }, 403);
  if (localDevelopment(c.req.raw)) return c.json({ ready: true });
  if (!env.CLIENT_SIGNING_KEY || !env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY)
    return c.json({ error: "The service is unavailable. Please try again later." }, 503);
  try {
    if (await readClient(clientCookie(c.req.raw), env.CLIENT_SIGNING_KEY))
      return c.json({ ready: true });
    const client = crypto.randomUUID();
    const headers = await visitorHeaders(c.req.raw, client);
    const token = c.req.header("X-Turnstile-Token");
    if (token) {
      if (token.length > 2_048)
        return c.json({ error: "Invalid verification. Please try again." }, 400);
      const verification = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
          signal: AbortSignal.timeout(8_000),
        },
      );
      const result = (await verification.json()) as {
        success?: boolean;
        hostname?: string;
        action?: string;
      };
      if (
        !result.success ||
        result.hostname !== new URL(c.req.url).hostname ||
        result.action !== "session"
      )
        return c.json({ error: "Verification failed. Please try again." }, 403);
      headers.set("X-Color-Verified", "1");
    }
    const response = await fetch(new URL("/api/session", env.COLOR_RELAY_URL), {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    const result = (await response.json()) as { code?: string };
    if (response.status === 403 && result.code === "verification_required")
      return c.json({ code: result.code, sitekey: env.TURNSTILE_SITE_KEY }, 403);
    if (!response.ok)
      return c.json({ error: "Unable to establish a session. Please try again later." }, 503);
    c.header(
      "Set-Cookie",
      clientCookie(c.req.raw, await issueClient(client, env.CLIENT_SIGNING_KEY)),
    );
    return c.json({ ready: true });
  } catch {
    return c.json({ error: "Unable to connect to the service. Please try again later." }, 503);
  }
});
