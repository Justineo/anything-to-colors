import type { CloudContext } from "void";
import { env } from "void/env";
import { clientCookie, readClient, sign } from "./identity";

export function localDevelopment(request: Request) {
  return (
    !env.CLIENT_SIGNING_KEY &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)
  );
}

export function checkOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  return (
    request.headers.get("X-Color-Request") === "1" &&
    request.headers.get("Sec-Fetch-Site") !== "cross-site" &&
    (!origin || origin === new URL(request.url).origin)
  );
}

export async function visitorHeaders(request: Request, client: string) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || !env.CLIENT_SIGNING_KEY || !env.COLOR_RELAY_URL || !env.COLOR_RELAY_TOKEN)
    throw new Error("Visitor protection is not configured");
  return new Headers({
    Authorization: `Bearer ${env.COLOR_RELAY_TOKEN}`,
    "X-Color-Client": client,
    "X-Color-IP": await sign(`ip:${ip}`, env.CLIENT_SIGNING_KEY),
  });
}

export async function clientAccess(c: CloudContext): Promise<Headers | Response> {
  c.header("Cache-Control", "no-store");
  if (!checkOrigin(c.req.raw))
    return c.json({ error: "Requests must originate from this website." }, 403);
  if (localDevelopment(c.req.raw)) return new Headers();
  try {
    const id =
      env.CLIENT_SIGNING_KEY && (await readClient(clientCookie(c.req.raw), env.CLIENT_SIGNING_KEY));
    if (!id)
      return c.json({ error: "Refresh the page and try again.", code: "session_required" }, 401);
    return await visitorHeaders(c.req.raw, id);
  } catch {
    return c.json({ error: "The service is unavailable. Please try again later." }, 503);
  }
}

export function admissionResponse(response: Response) {
  if (response.headers.get("X-Color-Admission") !== "denied") return null;
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  const retry = response.headers.get("Retry-After");
  if (retry) headers.set("Retry-After", retry);
  return new Response(response.body, { status: response.status, headers });
}
