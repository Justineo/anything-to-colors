import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { LimitStore, day, sessionLifetime } from "./rate-limit.mjs";

const now = 1_800_000_000_000;
function setup(dailyLimit) {
  const db = new DatabaseSync(":memory:");
  const storage = {
    sql: {
      exec(query, ...args) {
        const statement = db.prepare(query);
        const rows = statement.columns().length
          ? statement.all(...args)
          : (statement.run(...args), []);
        return {
          toArray: () => rows,
          one: () => {
            assert.equal(rows.length, 1);
            return rows[0];
          },
        };
      },
    },
    transactionSync(callback) {
      db.exec("BEGIN");
      try {
        const result = callback();
        db.exec("COMMIT");
        return result;
      } catch (cause) {
        db.exec("ROLLBACK");
        throw cause;
      }
    },
  };
  const limits = new LimitStore(storage, dailyLimit);
  function admit(client = "a", ip = "ip", at = now) {
    const result = limits.admit(client, ip, at);
    if (result.lease) limits.release(result.lease);
    return result;
  }
  limits.register("a", "ip", false, now);
  return { limits, storage, admit };
}

test("the 21st request is refused and the rolling minute recovers without a boundary burst", () => {
  const { limits, admit } = setup();
  for (let i = 0; i < 20; i++) assert.equal(admit("a", "ip", now + i * 1_000).status, 200);
  const blocked = admit("a", "ip", now + 20_000);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.retryAfter, 40);
  assert.equal(admit("a", "ip", now + 60_000).status, 200);
  assert.equal(admit("a", "ip", now + 60_001).status, 429);
  assert.equal(limits.sql.exec("SELECT COUNT(*) AS count FROM requests").one().count, 21);
});

test("hourly and daily quotas survive a new store instance", () => {
  const { limits, storage, admit } = setup();
  for (let i = 0; i < 300; i++) assert.equal(admit("a", "ip", now + i * 10_000).status, 200);
  const restored = new LimitStore(storage);
  assert.equal(restored.admit("a", "ip", now + 3_000_000).status, 429);
  assert.equal(restored.admit("a", "ip", now + 3_600_000).status, 200);

  const daily = setup();
  for (let i = 0; i < 1_000; i++)
    assert.equal(daily.admit("a", "ip", now + i * 60_000).status, 200);
  assert.equal(daily.admit("a", "ip", now + 1_000 * 60_000).status, 429);
  assert.equal(daily.admit("a", "ip", now + day).status, 200);
  assert.equal(limits.sql.exec("SELECT COUNT(*) AS count FROM requests").one().count, 301);
});

test("one cookie shares its quota across IPs while distinct cookies share the IP ceiling", () => {
  const { limits, admit } = setup();
  for (let i = 0; i < 20; i++) assert.equal(admit("a", `ip-${i}`).status, 200);
  assert.equal(admit("a", "another-ip").status, 429);
  for (let client = 0; client < 6; client++) {
    limits.register(`client-${client}`, "shared", false, now);
    for (let i = 0; i < 20; i++) assert.equal(admit(`client-${client}`, "shared").status, 200);
  }
  limits.register("extra", "shared", false, now);
  assert.equal(admit("extra", "shared").status, 429);
  assert.equal(admit("extra", "different").status, 200);
});

test("concurrency is enforced atomically and released, with expiry for interrupted handlers", () => {
  const { limits } = setup();
  const first = limits.admit("a", "ip", now);
  const second = limits.admit("a", "ip", now);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(limits.admit("a", "ip", now).status, 429);
  limits.release(first.lease);
  assert.equal(limits.admit("a", "ip", now + 1).status, 200);
  assert.equal(limits.admit("a", "ip", now + 45_001).status, 200);

  const shared = setup();
  for (let i = 0; i < 5; i++) {
    shared.limits.register(`client-${i}`, "shared", false, now);
    assert.equal(shared.limits.admit(`client-${i}`, "shared", now).status, 200);
    assert.equal(shared.limits.admit(`client-${i}`, "shared", now).status, 200);
  }
  shared.limits.register("extra", "shared", false, now);
  assert.equal(shared.limits.admit("extra", "shared", now).status, 429);
});

test("new identities require verification after ten registrations; verification never resets quotas", () => {
  const { limits, admit } = setup();
  for (let i = 1; i < 10; i++)
    assert.equal(limits.register(`client-${i}`, "ip", false, now).status, 200);
  assert.deepEqual(limits.register("extra", "ip", false, now), {
    status: 403,
    code: "verification_required",
  });
  assert.equal(limits.register("extra", "ip", true, now).status, 200);
  for (let i = 0; i < 20; i++) assert.equal(admit().status, 200);
  assert.equal(limits.register("verified", "ip", true, now).status, 200);
  assert.equal(admit().status, 429);
  assert.equal(limits.register("later", "ip", false, now + 600_000).status, 200);
});

test("global budget spans clients and IPs and resets at UTC midnight", () => {
  const { limits, admit } = setup(2);
  limits.register("b", "elsewhere", false, now);
  assert.equal(admit().status, 200);
  assert.equal(admit("b", "elsewhere").status, 200);
  const blocked = admit("b", "third");
  assert.equal(blocked.code, "daily_budget_exhausted");
  const midnight = (Math.floor(now / day) + 1) * day;
  assert.equal(blocked.retryAfter, (midnight - now) / 1_000);
  assert.equal(admit("b", "elsewhere", midnight).status, 200);
});

test("expired and unknown sessions cannot infer; cleanup removes old identifiers and requests", () => {
  const { limits, admit } = setup();
  assert.equal(admit("unknown").status, 401);
  assert.equal(admit().status, 200);
  limits.cleanup(now + sessionLifetime);
  assert.equal(admit("a", "ip", now + sessionLifetime).status, 401);
  for (const table of ["clients", "requests"])
    assert.equal(limits.sql.exec(`SELECT COUNT(*) AS count FROM ${table}`).one().count, 0);
});
