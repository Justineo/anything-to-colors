import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { clientCookie, issueClient, readClient, sign } from "./identity.ts";

const secret = "a-server-only-secret";
const now = 1_800_000_000_000;
const id = "e9310d6d-0718-49d1-a2b7-56f598c4f0a3";
afterEach(() => mock.restoreAll());

test("concurrent signing and verification reuse an imported key while secret rotation remains isolated", async () => {
  const imports = mock.method(crypto.subtle, "importKey");
  const active = "cached-signing-secret";
  const [, token] = await Promise.all([sign("ip:192.0.2.1", active), issueClient(id, active, now)]);
  assert.equal(await readClient(token, active, now), id);
  assert.equal(imports.mock.callCount(), 1);
  assert.equal(await readClient(token, "rotated-secret", now), null);
  assert.equal(await readClient(token, active, now), id);
  assert.equal(imports.mock.callCount(), 3);
});

test("signed browser identities survive refresh but reject forgery, expiry and future timestamps", async () => {
  const token = await issueClient(id, secret, now);
  assert.equal(await readClient(token, secret, now), id);
  assert.equal(await readClient(token, secret, now + 86_400_000), id);
  assert.equal(await readClient(token.replace(id, crypto.randomUUID()), secret, now), null);
  assert.equal(await readClient(token, "wrong-secret", now), null);
  assert.equal(await readClient(token, secret, now - 1_000), null);
  assert.equal(await readClient(token, secret, now + 30 * 86_400_000), null);
  for (const invalid of ["", "invalid", token + "x", token.slice(0, -1)])
    assert.equal(await readClient(invalid, secret, now), null);
});

test("production cookies are host-only, secure, HttpOnly and shared across paths", async () => {
  const request = new Request("https://colors.void.app/api/session");
  const token = await issueClient(id, secret, now);
  const cookie = clientCookie(request, token);
  assert.match(cookie, /^__Host-colors-client=/);
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=2592000"])
    assert.ok(cookie.includes(attribute));
  assert.ok(!cookie.includes("Domain="));
  assert.equal(
    clientCookie(new Request(request, { headers: { Cookie: `other=x; ${cookie.split(";")[0]}` } })),
    token,
  );
});

test("IP identifiers are stable keyed hashes and domain-separated from cookie signatures", async () => {
  const hash = await sign("ip:192.0.2.1", secret);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, await sign("ip:192.0.2.1", secret));
  assert.notEqual(hash, await sign("ip:192.0.2.2", secret));
  assert.notEqual(hash, await sign("client:192.0.2.1", secret));
});
