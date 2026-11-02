const lifetime = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();
let cached: { secret: string; key: Promise<CryptoKey> } | undefined;

function key(secret: string) {
  if (cached?.secret === secret) return cached.key;
  const imported = crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  cached = { secret, key: imported };
  return imported;
}

export async function sign(value: string, secret: string) {
  const signature = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function issueClient(id: string, secret: string, now = Date.now()) {
  const value = `${id}.${Math.floor(now / 1_000)}`;
  return `${value}.${await sign(`client:${value}`, secret)}`;
}

export async function readClient(value: string, secret: string, now = Date.now()) {
  const match =
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{10})\.([0-9a-f]{64})$/.exec(
      value,
    );
  if (!match) return null;
  const [, id, issued, signature] = match;
  const age = Math.floor(now / 1_000) - Number(issued);
  if (age < 0 || age >= lifetime) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await key(secret),
    Uint8Array.from(signature.match(/../g)!, (byte) => parseInt(byte, 16)),
    encoder.encode(`client:${id}.${issued}`),
  );
  return valid ? id : null;
}

export function clientCookie(request: Request, value?: string) {
  const secure = new URL(request.url).protocol === "https:";
  const name = secure ? "__Host-colors-client" : "colors-client";
  if (value !== undefined)
    return `${name}=${value}; Path=/; Max-Age=${lifetime}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  return (
    request.headers
      .get("Cookie")
      ?.split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? ""
  );
}
