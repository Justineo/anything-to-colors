import "./verification.css";
import { locale, messagesForLocale as copyText } from "./locale";

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};

let loading: Promise<Turnstile> | undefined;
function load() {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    const failed = () => {
      clearTimeout(timer);
      script.remove();
      loading = undefined;
      reject(new Error("Unable to load verification. Please try again later."));
    };
    const timer = setTimeout(failed, 15_000);
    script.onload = () => {
      clearTimeout(timer);
      resolve((window as unknown as { turnstile: Turnstile }).turnstile);
    };
    script.onerror = failed;
    document.head.appendChild(script);
  });
  return loading;
}

export async function verifyVisitor(sitekey: string, signal?: AbortSignal | null) {
  signal?.throwIfAborted();
  const dialog = document.createElement("dialog");
  const previousFocus = document.activeElement;
  dialog.className = "verification";
  const title = document.createElement("h2");
  title.id = "verification-title";
  title.textContent = copyText.verify;
  dialog.setAttribute("aria-labelledby", title.id);
  const widget = document.createElement("div");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = copyText.cancel;
  for (const element of [title, widget, cancel]) dialog.appendChild(element);
  document.body.appendChild(dialog);
  dialog.showModal();
  let turnstile: Turnstile | undefined;
  let widgetId: string | undefined;
  let stop: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      stop = () => reject(new Error("Verification cancelled. You can try again later."));
      dialog.addEventListener("cancel", stop);
      cancel.addEventListener("click", stop);
      signal?.addEventListener("abort", stop, { once: true });
      timer = setTimeout(
        () => reject(new Error("Verification timed out. Please try again.")),
        120_000,
      );
      void load()
        .then((api) => {
          if (!dialog.isConnected || signal?.aborted) return;
          turnstile = api;
          widgetId = api.render(widget, {
            sitekey,
            action: "session",
            theme: "auto",
            language: locale === "zh" ? "zh-cn" : locale,
            callback: resolve,
            "error-callback": () => reject(new Error("Verification failed. Please try again.")),
            "expired-callback": () => reject(new Error("Verification expired. Please try again.")),
          });
        })
        .catch(reject);
    });
  } finally {
    clearTimeout(timer);
    if (stop) signal?.removeEventListener("abort", stop);
    if (turnstile && widgetId !== undefined) turnstile.remove(widgetId);
    dialog.close();
    dialog.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }
}
