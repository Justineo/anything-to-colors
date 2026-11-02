// Keep the deadline active through body reads, including after fetch resolves.
function deadline(ms: number, signal?: AbortSignal | null) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("The operation timed out.", "TimeoutError")),
    ms,
  );
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  if (signal?.aborted) controller.abort(signal.reason);
  else
    signal?.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
      signal: controller.signal,
    });
  return controller.signal;
}

export function createApi(
  verify: (sitekey: string, signal?: AbortSignal | null) => Promise<string>,
  limited: (seconds: number) => void,
) {
  let session: Promise<string | undefined> | undefined;
  let verification: Promise<void> | undefined;

  async function establish(token?: string) {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "X-Color-Request": "1", ...(token ? { "X-Turnstile-Token": token } : {}) },
      signal: deadline(12_000),
    });
    const result = (await response.json()) as {
      ready?: boolean;
      code?: string;
      sitekey?: string;
      error?: string;
    };
    if (response.ok && result.ready) return;
    if (token === undefined && result.code === "verification_required" && result.sitekey)
      return result.sitekey;
    throw new Error(result.error || "Unable to establish a session. Please try again.");
  }

  function prepare() {
    // This shared, unpaid request outlives any one caller's cancellation.
    // A challenge is cached here; only an explicit submission may open verification UI.
    session ??= establish().catch((cause) => {
      session = undefined;
      throw cause;
    });
    return session;
  }

  const api = async (path: "/api/color" | "/api/transcribe", init: RequestInit) => {
    init.signal?.throwIfAborted();
    const sitekey = await prepare();
    init.signal?.throwIfAborted();
    if (sitekey) {
      verification ??= verify(sitekey, init.signal)
        .then(async (token) => {
          await establish(token);
          session = Promise.resolve(undefined);
        })
        .catch((cause) => {
          session = undefined;
          throw cause;
        })
        .finally(() => {
          verification = undefined;
        });
      await verification;
    }
    init.signal?.throwIfAborted();
    const headers = new Headers(init.headers);
    headers.set("X-Color-Request", "1");
    const response = await fetch(path, {
      ...init,
      headers,
      signal: deadline(path === "/api/color" ? 20_000 : 28_000, init.signal),
    });
    if (response.status === 401) session = undefined;
    if (response.status === 429) {
      const retry = Number(response.headers.get("Retry-After"));
      limited(Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : 60);
    }
    return response;
  };

  return Object.assign(api, {
    prepare: () =>
      prepare().then(
        () => {},
        () => {},
      ),
  });
}
