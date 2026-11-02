const minute = 60_000;
const hour = 60 * minute;
export const day = 24 * hour;
export const sessionLifetime = 30 * day;

// All admissions run synchronously in one Durable Object, so checking every
// quota and recording a request cannot interleave with another admission.
export class LimitStore {
  constructor(storage, dailyLimit = 10_000) {
    this.storage = storage;
    this.sql = storage.sql;
    this.dailyLimit = dailyLimit;
    this.cleanupAt = 0;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY, ip TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS clients_ip_created ON clients(ip, created)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS clients_expires ON clients(expires)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, client TEXT NOT NULL, ip TEXT NOT NULL,
      at INTEGER NOT NULL, active_until INTEGER NOT NULL
    )`);
    for (const column of ["client", "ip"]) {
      this.sql.exec(`CREATE INDEX IF NOT EXISTS requests_${column}_at ON requests(${column}, at)`);
      this.sql.exec(
        `CREATE INDEX IF NOT EXISTS requests_${column}_active ON requests(${column}, active_until)`,
      );
    }
    this.sql.exec("CREATE INDEX IF NOT EXISTS requests_at ON requests(at)");
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS budgets (day INTEGER PRIMARY KEY, used INTEGER NOT NULL)",
    );
  }

  cleanup(now = Date.now()) {
    this.sql.exec("DELETE FROM requests WHERE at <= ?", now - day);
    this.sql.exec("DELETE FROM clients WHERE expires <= ?", now);
    this.sql.exec("DELETE FROM budgets WHERE day < ?", Math.floor(now / day) * day);
    this.cleanupAt = now + hour;
  }

  register(id, ip, verified, now = Date.now()) {
    if (now >= this.cleanupAt) this.cleanup(now);
    const { count } = this.sql
      .exec(
        "SELECT COUNT(*) AS count FROM clients WHERE ip = ? AND created > ?",
        ip,
        now - 10 * minute,
      )
      .one();
    if (count >= 10 && !verified) return { status: 403, code: "verification_required" };
    this.sql.exec(
      "INSERT INTO clients (id, ip, created, expires) VALUES (?, ?, ?, ?)",
      id,
      ip,
      now,
      now + sessionLifetime,
    );
    return { status: 200 };
  }

  admit(client, ip, now = Date.now()) {
    if (now >= this.cleanupAt) this.cleanup(now);
    if (
      !this.sql.exec("SELECT id FROM clients WHERE id = ? AND expires > ?", client, now).toArray()
        .length
    )
      return { status: 401, code: "session_required" };

    return this.storage.transactionSync(() => {
      let retryAt = now;
      for (const [column, key, periods, concurrent] of [
        [
          "client",
          client,
          [
            [minute, 20],
            [hour, 300],
            [day, 1_000],
          ],
          2,
        ],
        [
          "ip",
          ip,
          [
            [minute, 120],
            [hour, 1_200],
          ],
          10,
        ],
      ]) {
        for (const [period, limit] of periods) {
          const { count, first } = this.sql
            .exec(
              `SELECT COUNT(*) AS count, MIN(at) AS first FROM requests WHERE ${column} = ? AND at > ?`,
              key,
              now - period,
            )
            .one();
          if (count >= limit) retryAt = Math.max(retryAt, first + period);
        }
        const { count, first } = this.sql
          .exec(
            `SELECT COUNT(*) AS count, MIN(active_until) AS first FROM requests WHERE ${column} = ? AND active_until > ?`,
            key,
            now,
          )
          .one();
        if (count >= concurrent) retryAt = Math.max(retryAt, first);
      }
      const midnight = Math.floor(now / day) * day;
      const budget = this.sql.exec("SELECT used FROM budgets WHERE day = ?", midnight).toArray()[0];
      if ((budget?.used ?? 0) >= this.dailyLimit)
        return {
          status: 429,
          code: "daily_budget_exhausted",
          retryAfter: Math.ceil((midnight + day - now) / 1_000),
        };
      if (retryAt > now)
        return {
          status: 429,
          code: "rate_limited",
          retryAfter: Math.ceil((retryAt - now) / 1_000),
        };

      const lease = crypto.randomUUID();
      // The upstream job times out within 23 seconds. A lease also releases
      // concurrency when an HTTP handler is interrupted before its finally.
      this.sql.exec(
        "INSERT INTO requests (id, client, ip, at, active_until) VALUES (?, ?, ?, ?, ?)",
        lease,
        client,
        ip,
        now,
        now + 45_000,
      );
      this.sql.exec(
        "INSERT INTO budgets (day, used) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET used = used + 1",
        midnight,
      );
      return { status: 200, lease };
    });
  }

  release(lease) {
    this.sql.exec("UPDATE requests SET active_until = 0 WHERE id = ?", lease);
  }
}
