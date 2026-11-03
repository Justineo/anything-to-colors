import { DurableObject } from "cloudflare:workers";
import { LimitStore, day } from "./rate-limit.mjs";

export class RateLimiter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const limit = Number(env.DAILY_REQUEST_LIMIT ?? 10_000);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid DAILY_REQUEST_LIMIT");
    this.limits = new LimitStore(ctx.storage, limit);
  }

  async register(client, ip, verified) {
    const result = this.limits.register(client, ip, verified);
    await this.scheduleCleanup();
    return result;
  }

  async admit(client, ip) {
    const result = this.limits.admit(client, ip);
    await this.scheduleCleanup();
    return result;
  }

  release(lease) {
    this.limits.release(lease);
  }

  async scheduleCleanup() {
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + day);
  }

  async alarm() {
    this.limits.cleanup();
    if (this.limits.sql.exec("SELECT COUNT(*) AS count FROM clients").one().count)
      await this.ctx.storage.setAlarm(Date.now() + day);
  }
}

// Process queued inference in an alarm event.
export class ColorJob extends DurableObject {
  completion;

  async run(body, audioType) {
    await this.start(body, audioType);
    return this.wait(audioType ? 23_000 : 15_000);
  }

  async start(body, audioType) {
    await this.ctx.storage.put("job", { body, audioType, expiresAt: Date.now() + 60_000 });
    await this.ctx.storage.setAlarm(Date.now());
  }

  async take() {
    const result = (await this.ctx.storage.get("job"))?.result;
    if (result) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
    }
    return result;
  }

  async wait(timeout) {
    // Register before reading storage so an alarm finishing between the read and await
    // cannot lose its wake-up. The timer also bounds an interrupted or reset job.
    this.completion ??= Promise.withResolvers();
    const ready = await this.take();
    if (ready) return ready;
    let timer;
    try {
      await Promise.race([
        this.completion.promise,
        new Promise((resolve) => {
          timer = setTimeout(resolve, timeout);
        }),
      ]);
      return await this.take();
    } finally {
      clearTimeout(timer);
    }
  }

  async alarm() {
    const job = await this.ctx.storage.get("job");
    if (!job || Date.now() >= job.expiresAt) {
      await this.ctx.storage.deleteAll();
      return;
    }
    if (!job.body) {
      await this.ctx.storage.setAlarm(job.expiresAt);
      return;
    }
    // Claim and remove the input before calling OpenAI, so alarm retries cannot charge twice.
    await this.ctx.storage.put("job", { expiresAt: job.expiresAt });
    const start = performance.now();
    let result;
    try {
      let body = job.body;
      const headers = { Authorization: `Bearer ${this.env.OPENAI_API_KEY}` };
      if (job.audioType) {
        body = new FormData();
        body.set("model", "gpt-transcribe");
        body.set(
          "file",
          new Blob([job.body], { type: job.audioType }),
          `voice.${audioExtension(job.audioType)}`,
        );
      } else headers["Content-Type"] = "application/json";
      const response = await fetch(
        job.audioType
          ? "https://api.openai.com/v1/audio/transcriptions"
          : "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(job.audioType ? 20_000 : 12_000),
        },
      );
      result = { status: response.status, body: await response.text() };
    } catch {
      result = { status: 504, body: JSON.stringify({ error: "OpenAI request timed out" }) };
    }
    const expiresAt = Date.now() + 60_000;
    await this.ctx.storage.put("job", {
      expiresAt,
      result: { ...result, ms: Math.round(performance.now() - start) },
    });
    // Reclaim uncollected results when the caller disconnects or times out.
    await this.ctx.storage.setAlarm(expiresAt);
    this.completion?.resolve();
  }
}

const audioTypes = new Map([
  ["audio/webm", "webm"],
  ["audio/mp4", "mp4"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
]);

function audioExtension(type) {
  return audioTypes.get(type.split(";")[0].trim().toLowerCase());
}

async function readAudio(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return size ? new Blob(chunks).arrayBuffer() : null;
}

export default {
  async fetch(request, env) {
    const began = performance.now();
    const path = new URL(request.url).pathname;
    const audio = path === "/api/transcribe";
    const session = path === "/api/session";
    if (path !== "/api/color" && !audio && !session)
      return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (
      !env.COLOR_RELAY_TOKEN ||
      request.headers.get("Authorization") !== `Bearer ${env.COLOR_RELAY_TOKEN}`
    )
      return new Response("Unauthorized", { status: 401 });
    const client = request.headers.get("X-Color-Client") ?? "";
    const ip = request.headers.get("X-Color-IP") ?? "";
    if (!/^[0-9a-f-]{36}$/.test(client) || !/^[0-9a-f]{64}$/.test(ip))
      return Response.json(
        { error: "Missing visitor identity", code: "session_required" },
        {
          status: 401,
          headers: { "Cache-Control": "no-store", "X-Color-Admission": "denied" },
        },
      );
    const limiter = env.RATE_LIMITS.get(env.RATE_LIMITS.idFromName("global"));
    if (session) {
      const result = await limiter.register(
        client,
        ip,
        request.headers.get("X-Color-Verified") === "1",
      );
      return Response.json(result, {
        status: result.status,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const audioType = request.headers.get("Content-Type") ?? "";
    if (audio && !audioExtension(audioType))
      return new Response("Unsupported audio type", { status: 415 });
    const body = audio ? await readAudio(request) : await request.text();
    if (!body || (!audio && new TextEncoder().encode(body).length > 32_768))
      return new Response("Payload too large", { status: 413 });
    const admission = await limiter.admit(client, ip);
    const admitted = performance.now();
    if (admission.status !== 200)
      return Response.json(
        {
          ...admission,
          error:
            admission.code === "daily_budget_exhausted"
              ? "The daily request budget is exhausted. Please try again tomorrow."
              : admission.code === "session_required"
                ? "Your session has expired. Refresh the page and try again."
                : "Too many requests. Please try again later.",
        },
        {
          status: admission.status,
          headers: {
            "Cache-Control": "no-store",
            "X-Color-Admission": "denied",
            ...(admission.retryAfter ? { "Retry-After": String(admission.retryAfter) } : {}),
          },
        },
      );
    try {
      const job = env.COLOR_JOBS.get(env.COLOR_JOBS.idFromName(crypto.randomUUID()), {
        locationHint: "wnam",
      });
      const result = await job.run(body, audio ? audioType : undefined);
      if (result)
        return new Response(result.body, {
          status: result.status,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "Server-Timing": `${audio ? "transcription" : "inference"};dur=${result.ms}, admission;dur=${Math.round(admitted - began)}, relay;dur=${Math.round(performance.now() - began)}`,
          },
        });
      return new Response(JSON.stringify({ error: "Color job timed out" }), {
        status: 504,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } finally {
      await limiter.release(admission.lease);
    }
  },
};
