<script setup vapor lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { Atelier, cancelDuration, type Caret, type Glyph } from "./engine";
import { foreground } from "./contrast";
import { meanColor, paletteEdges } from "./color";
import { fit, graphemes, leading, weight } from "./typography";
import { onFontsReady, serif, warmFonts } from "./fonts";
import { trackViewport } from "./viewport";
import { presets, textureOf, type Entry } from "./presets";
import { createExamples } from "./examples";
import { cancelPadding, holdRecorder, outsideRecordingArea, type VoiceState } from "./voice";
import type { VoicePhase } from "./engine";
import { MATERIALS, parseMaterial, type Material } from "./materials";
import { createApi } from "./api";
import { messagesForLocale as copyText, presetCaptions } from "./locale";
import { maxTextLength } from "../shared/limits.ts";
import { readPalette } from "../shared/palette";

const examples = createExamples(presets.length);
const example = (index: number): Entry => ({
  text: presetCaptions[index],
  ...presets[index],
  material: textureOf(index),
});
const current = ref<Entry>(example(examples.current));
// Bumped for every new palette so the caption and strip replay their entrance.
const shown = ref(0);
const input = ref("");
const phase = ref<"idle" | "thinking" | "reveal">("idle");
const busy = computed(() => phase.value !== "idle");
const cancelling = ref(false);
// True while the GL copy of the words owns the screen and the DOM text steps aside.
const handoff = ref(false);
let retryUntil = 0;
const api = createApi(
  async (sitekey, signal) => (await import("./verification")).verifyVisitor(sitekey, signal),
  (seconds) => {
    retryUntil = Date.now() + seconds * 1_000;
  },
);
const copied = ref("");
const fallback = ref(false);
// While developing (or with ?debug), a corner label names the liquid showing, to judge each one.
const debug = import.meta.env.DEV || new URLSearchParams(location.search).has("debug");
const liquid = ref("");
const liquids = Object.keys(MATERIALS) as Material[];
const arrivals = ["bloom", "tide"] as const;
const arrival = ref<(typeof arrivals)[number]>("bloom");
/** Jumps to a random example shown in this liquid, through the usual dissolve and reveal. */
function showLiquid(material: Material) {
  const choices = presets
    .map((_, index) => index)
    .filter(
      (index) => textureOf(index) === material && presetCaptions[index] !== current.value.text,
    );
  if (choices.length) void changeExample(1, choices[Math.floor(Math.random() * choices.length)]);
}
function chooseArrival(mode: (typeof arrivals)[number]) {
  arrival.value = mode;
  if (atelier) atelier.arrival = mode;
}
const fine = ref(true);
let width = 1200;
let height = 800;
const editor = ref<HTMLTextAreaElement>();
const words = ref<HTMLDivElement>();
const mirror = ref<HTMLDivElement>();
const canvas = ref<HTMLCanvasElement>();
const corner = ref<HTMLElement>();
const hint = ref<HTMLElement>();
const focused = ref(false);
const voiceState = ref<VoiceState>("idle");
let voiceSupported = false;
// The hint names no gesture: writing, speaking and holding are there to be found.
const invite = graphemes(copyText.invite);
const recording = computed(
  () => voiceState.value === "recording" || voiceState.value === "permission",
);
const locked = computed(() => busy.value || cancelling.value || voiceState.value !== "idle");
// Spoken only to screen readers; on screen the painting itself shows the voice being heard.
const voiceStatus = computed(() =>
  cancelling.value
    ? copyText.cancel
    : voiceState.value === "permission"
      ? copyText.permission
      : voiceState.value === "recording"
        ? copyText.listening
        : voiceState.value === "sending" && !busy.value
          ? copyText.transcribing
          : "",
);

const chars = computed(() => graphemes(input.value));
const average = computed(() => meanColor(current.value.colors, current.value.weights));
const ink = computed(() => foreground(average.value));
const stops = computed(() => {
  const { colors, weights } = current.value;
  if (!weights || colors.length === 1)
    return colors.map((color, i) => ({ color, at: i / Math.max(1, colors.length - 1) }));
  const edges = paletteEdges(colors.length, weights);
  return colors.flatMap((color, i) => [
    { color, at: i === 0 ? 0 : edges[2 * i - 1] },
    { color, at: i === colors.length - 1 ? 1 : edges[2 * i] },
  ]);
});
const paint = computed(() => {
  const gradient = stops.value.map(({ color, at }) => `${color} ${at * 100}%`);
  if (gradient.length === 1) gradient.push(stops.value[0].color);
  return `linear-gradient(125deg, ${gradient.join(", ")})`;
});

let atelier: Atelier | undefined;
let request: AbortController | undefined;
let resizer: ResizeObserver | undefined;
let follower: ResizeObserver | undefined;
// Where the caption's words were when they were drawn into the painting.
let captionAt = { left: 0, top: 0 };
let copyTimer: ReturnType<typeof setTimeout> | undefined;
let alive = true;
let stopViewport: (() => void) | undefined;
let stopFonts: (() => void) | undefined;
let focusedOnPointerDown = false;
let voicePointer: number | undefined;
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let cancelTimer: ReturnType<typeof setTimeout> | undefined;
let composing = false;
let voiceConsumed = false;
// Where the voice is being heard, in css px.
let voicePoint = { x: 0, y: 0 };
// Follows the microphone's loudness while a voice is heard and hands it to the painting.
let listening: { context: AudioContext; frame: number } | undefined;
function follow(stream: MediaStream) {
  unfollow();
  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const tick = () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    // Loudness on a gentle curve: a quiet voice already moves the paint, shouting does not flood it.
    const rms = Math.sqrt(sum / samples.length);
    atelier?.hear(Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-6) + 52) / 34)));
    if (listening) listening.frame = requestAnimationFrame(tick);
  };
  listening = { context, frame: requestAnimationFrame(tick) };
  void context.resume();
}
function unfollow() {
  if (!listening) return;
  cancelAnimationFrame(listening.frame);
  void listening.context.close();
  listening = undefined;
}
const voice = holdRecorder({
  state: (state) => {
    voiceState.value = state;
  },
  stream: follow,
  error: () => {
    if (alive) reset();
  },
  limit: cancelInput,
  audio: async (audio) => {
    const controller = (request = new AbortController());
    const response = await api("/api/transcribe", {
      method: "POST",
      body: audio,
      signal: controller.signal,
    });
    const result = (await response.json()) as { text?: unknown; error?: string; code?: string };
    if (result.code === "text_too_long") return cancelInput();
    if (!response.ok) throw new Error(result.error || "Transcription failed. Please try again.");
    if (typeof result.text !== "string" || !result.text.trim())
      throw new Error("No speech was recognized. Press and hold to try again.");
    if (!alive) return;
    const text = result.text.trim();
    if (text.length > maxTextLength) return cancelInput();
    const color = requestColor(text);
    // Keep inference running while the complete transcript's fonts are prepared off screen.
    await warmFonts(text);
    if (!alive || color.controller.signal.aborted) return;
    // A transcript replaces the draft, even when they happen to share a prefix or suffix.
    if (input.value !== text) atelier?.setWriting([], "", null);
    input.value = text;
    atelier?.setVoice("off");
    await nextTick();
    // Let the words that were heard condense in the painting for a moment before they go.
    await wait(1100);
    if (!alive) return;
    await submit(color);
  },
});

function reset() {
  clearTimeout(cancelTimer);
  cancelling.value = false;
  input.value = "";
  if (editor.value) editor.value.value = "";
  handoff.value = false;
  phase.value = "idle";
  atelier?.reset();
  void nextTick(() => {
    drawWriting();
    presentCaption();
    presentInvite(0);
  });
}

function cancelInput() {
  if (!alive || cancelling.value) return;
  clearTimeout(holdTimer);
  voicePointer = undefined;
  voiceConsumed = true;
  request?.abort();
  cancelling.value = true;
  composing = false;
  editor.value?.blur();
  const duration =
    atelier?.cancelInput() ??
    (matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : cancelDuration);
  cancelTimer = setTimeout(() => {
    if (alive) reset();
  }, duration);
}

function cancelVoice() {
  clearTimeout(holdTimer);
  voicePointer = undefined;
  // Once sent, releasing pointer capture or blurring must not cancel generation.
  if (recording.value) {
    voice.cancel();
    cancelInput();
  }
}

function beginVoice(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || voicePointer !== undefined) return;
  rememberFocus();
  voiceConsumed = false;
  if ((event.target as Element).closest("textarea, button, footer")) return;
  if (locked.value) return;
  voicePointer = event.pointerId;
  const { clientX: x, clientY: y } = event;
  const surface = event.currentTarget as HTMLElement;
  voicePoint = { x, y };
  surface.setPointerCapture(event.pointerId);
  // A draft uses background taps to submit; dragging still stirs the paint without sending.
  if (input.value.trim() || composing || !voiceSupported || Date.now() < retryUntil) return;
  holdTimer = setTimeout(() => {
    if (voicePointer !== event.pointerId || locked.value || input.value.trim() || composing) return;
    voiceConsumed = true;
    editor.value?.blur();
    void api.prepare();
    void voice.start();
  }, 350);
}

function moveVoice(event: PointerEvent) {
  if (event.pointerId !== voicePointer) return;
  const { x, y } = voicePoint;
  const moved = voiceConsumed
    ? outsideRecordingArea(event.clientX, event.clientY, voicePoint)
    : Math.hypot(event.clientX - x, event.clientY - y) > 12;
  if (moved) {
    voiceConsumed = true;
    cancelVoice();
    return;
  }
  // Straying toward the edge of the area thins the voice's mark: that is how letting go shows.
  if (voiceConsumed) {
    const drift = Math.max(Math.abs(event.clientX - x), Math.abs(event.clientY - y));
    atelier?.stray((drift - 24) / (28 + cancelPadding - 24));
  }
}

function releaseVoice(event: PointerEvent) {
  if (event.pointerId !== voicePointer) return;
  moveVoice(event);
  if (event.pointerId !== voicePointer) return;
  clearTimeout(holdTimer);
  voicePointer = undefined;
  voice.release();
}

function cancelVoicePointer(event: PointerEvent) {
  if (event.pointerId === voicePointer) cancelVoice();
}

function voiceContext(event: MouseEvent) {
  if (voiceConsumed) event.preventDefault();
}

function visibility() {
  if (document.hidden) cancelVoice();
}

const refit = () => {
  if (!alive) return;
  void nextTick(() => {
    if (!alive) return;
    drawLabels();
    layoutWriting();
  });
};

let writingSize = 84;
function layoutWriting(settled = false) {
  if (!words.value) return;
  writingSize = fit(words.value, width, height);
  drawWriting(settled);
}

// The words being written are laid out by the DOM (transparent, under an invisible textarea)
// and drawn by the painting in its own ink. The engine gets every character's place, and the
// caret and selection as the textarea has them. `settled` hands over words already showing.
function drawWriting(settled = false) {
  const root = mirror.value;
  if (!atelier || busy.value || cancelling.value || !root) return;
  const spans = Array.from(root.querySelectorAll<HTMLElement>(".ch"));
  const placed: Glyph[] = [];
  // For each grapheme, how many drawn characters come before it (spaces are not drawn).
  const before: number[] = [];
  for (const span of spans) {
    before.push(placed.length);
    const glyph = readGlyph(span);
    if (glyph) placed.push(glyph);
  }
  before.push(placed.length);
  let caret: Caret | null = null;
  const field = editor.value;
  if (field && focused.value && input.value) {
    const parts = chars.value;
    const index = (offset: number) => {
      let units = 0,
        i = 0;
      while (i < parts.length && units < offset) units += parts[i++].length;
      return i;
    };
    const start = index(field.selectionStart),
      end = index(field.selectionEnd);
    // A collapsed range right before the character after the caret (or the closing zero-width
    // space) lands where the browser would put the caret, including at the start of a line.
    const range = document.createRange();
    range.setStart(spans[end]?.firstChild ?? root.lastChild!, 0);
    const rect = range.getBoundingClientRect();
    caret = {
      left: rect.left,
      top: rect.top,
      height: rect.height || writingSize * leading,
      selection: [before[start], before[end]],
    };
  }
  atelier.setWriting(placed, `${weight} ${writingSize}px ${serif}`, caret, settled);
}
const selected = () => {
  if (document.activeElement === editor.value) drawWriting();
};
let captionTimer: ReturnType<typeof setTimeout> | undefined;
let inviteTimer: ReturnType<typeof setTimeout> | undefined;
let openingFontTimer: ReturnType<typeof setTimeout> | undefined;

function labelFont(element: HTMLElement) {
  const style = getComputedStyle(element);
  return `${style.fontWeight} ${style.fontSize} ${serif}`;
}

// The caption and the hint are laid out by the DOM (transparent, for layout and screen readers)
// and drawn by the painting itself, each stroke pixel a deeper or paler shade of what lies
// behind it. Caption lines past the second end in an ellipsis.
function drawLabels() {
  const element = corner.value?.querySelector<HTMLElement>(".caption");
  const box = element?.getBoundingClientRect();
  if (!atelier || !element || !box || !hint.value) return;
  atelier.setLabel("caption", captionGlyphs(element), labelFont(element));
  captionAt = { left: box.left, top: box.top };
  atelier.setLabel("invite", glyphs(hint.value), labelFont(hint.value));
}

// Hidden while the words come apart and the colors flow in, back once they settle, dimmed while typing.
function presentCaption(delay = 0) {
  clearTimeout(captionTimer);
  if (phase.value !== "idle") return atelier?.showLabel("caption", 0);
  captionTimer = setTimeout(() => atelier?.showLabel("caption", input.value ? 0.3 : 1), delay);
}

// The hint steps aside the moment anything is written, and comes back, unhurried, once the
// page is empty and still again.
function presentInvite(delay = 1600) {
  clearTimeout(inviteTimer);
  // It stays while a voice is heard, and gives way to the words once they arrive, as when typing.
  if (input.value || busy.value) return atelier?.showLabel("invite", 0);
  inviteTimer = setTimeout(() => atelier?.showLabel("invite", 1), delay);
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Over the corner's controls the system cursor takes over from the painted ring.
const ring = (on: boolean) => atelier?.showRing(on);

function focus() {
  if (!locked.value) editor.value?.focus({ preventScroll: true });
}

function rememberFocus() {
  // The browser may blur the textarea before dispatching the background's click.
  focusedOnPointerDown = document.activeElement === editor.value;
}

function tap(event: MouseEvent) {
  if (voiceConsumed) {
    voiceConsumed = false;
    return;
  }
  const dismiss = !fine.value && focusedOnPointerDown;
  focusedOnPointerDown = false;
  if ((event.target as Element).closest("textarea, button, footer") || locked.value || composing)
    return;
  if (input.value.trim()) {
    editor.value?.blur();
    void submit();
    return;
  }
  // Keep focus inside the tap itself: iOS cannot open its keyboard from a delayed callback.
  if (dismiss) editor.value?.blur();
  else focus();
}

function write(event: Event) {
  if (cancelling.value) return;
  // Read the raw value so IME composition is visible as it is typed.
  const value = (event.target as HTMLTextAreaElement).value;
  if (!composing && !(event as InputEvent).isComposing && value.length > maxTextLength)
    return cancelInput();
  input.value = value;
  if (input.value) void api.prepare();
}

function composed(event: CompositionEvent) {
  composing = false;
  write(event);
}

function enter(event: KeyboardEvent) {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !composing &&
    !event.isComposing &&
    event.keyCode !== 229
  ) {
    event.preventDefault();
    void submit();
  }
}

function keys(event: KeyboardEvent) {
  if (event.key === "Escape") cancelVoice();
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  if (locked.value || event.metaKey || event.ctrlKey || event.altKey) return;
  const direction =
    event.key === "ArrowLeft" || event.key === "ArrowUp"
      ? -1
      : event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : 0;
  if (direction && !input.value && !event.shiftKey) {
    event.preventDefault();
    if (!event.repeat) void changeExample(direction);
    return;
  }
  if (event.target instanceof HTMLElement && event.target.closest("button")) return;
  if (event.key.length === 1 && event.target !== editor.value) focus();
}

// The tab icon and browser chrome wear the current palette: the icon runs first color
// lower left to last upper right, like the painting; the chrome takes its average.
function brand() {
  const gradient = stops.value
    .map(({ color, at }) => `<stop offset="${at}" stop-color="${color}"/>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0">${gradient}</linearGradient></defs><circle cx="16" cy="16" r="15" fill="url(#g)"/></svg>`;
  document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href =
    `data:image/svg+xml,${encodeURIComponent(svg)}`;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content = average.value;
}

function readGlyph(element: HTMLElement): Glyph | undefined {
  const char = element.textContent ?? "";
  if (!char.trim()) return;
  const rect = element.getBoundingClientRect();
  return { char, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function glyphs(root: HTMLElement | undefined = mirror.value): Glyph[] {
  return Array.from(root?.querySelectorAll<HTMLElement>(".ch") ?? []).flatMap((element) => {
    const glyph = readGlyph(element);
    return glyph ? [glyph] : [];
  });
}

function captionGlyphs(element: HTMLElement) {
  const bottom = element.getBoundingClientRect().bottom;
  const all = glyphs(element);
  const visible = all.filter((glyph) => glyph.top + glyph.height / 2 < bottom);
  if (visible.length < all.length && visible.length)
    visible[visible.length - 1] = { ...visible[visible.length - 1], char: "…" };
  return visible;
}

function requestColor(text: string) {
  const controller = (request = new AbortController());
  // Settle transport failures as data while voice text is still arriving on screen.
  // This lets inference overlap that entrance without an unhandled rejection.
  const result = api("/api/color", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: controller.signal,
  }).then(
    (response) => ({ response }),
    (error: unknown) => ({ error }),
  );
  return { controller, result };
}

/** `chosen` shows that example instead of the next one (for the debug panel). */
async function changeExample(direction: -1 | 1 = 1, chosen?: number) {
  if (!alive || locked.value || input.value) return;
  const next = example(chosen ?? examples.move(direction));
  void warmFonts(next.text);
  const caption = corner.value?.querySelector<HTMLElement>(".caption");
  const began = performance.now();
  phase.value = "thinking";
  try {
    let animated = false;
    if (caption) {
      animated = (await atelier?.dissolve(captionGlyphs(caption), labelFont(caption))) ?? false;
    }
    if (animated) await wait(Math.max(0, 3000 - (performance.now() - began)));
    if (!alive) return;
    phase.value = "reveal";
    await atelier?.reveal(next, next.material);
    if (!alive) return;
    current.value = next;
    shown.value++;
  } catch {
    if (alive) reset();
  } finally {
    if (alive) phase.value = "idle";
  }
}

async function submit(pending?: ReturnType<typeof requestColor>) {
  const text = input.value.trim();
  if (busy.value || cancelling.value || recording.value || !text) return;
  if (text.length > maxTextLength) {
    pending?.controller.abort();
    return cancelInput();
  }
  if (Date.now() < retryUntil) {
    pending?.controller.abort();
    return reset();
  }
  phase.value = "thinking";
  const began = performance.now();
  const flight = pending ?? requestColor(text);
  const { controller } = flight;
  try {
    // Session/network work starts before rasterizing the words or waiting for a GL frame.
    const [result, animated] = await Promise.all([
      flight.result,
      (async () => {
        await nextTick();
        if (!alive || controller.signal.aborted) return false;
        const animated = (await atelier?.dissolve(glyphs(), labelFont(mirror.value!))) ?? false;
        if (animated && alive && !controller.signal.aborted) handoff.value = true;
        return animated;
      })(),
    ]);
    if ("error" in result) throw result.error;
    const response = result.response;
    const body = (await response.json().catch(() => null)) as {
      colors?: unknown;
      weights?: unknown;
      error?: string;
    } | null;
    const palette = readPalette(body?.colors, body?.weights);
    if (!response.ok || !palette)
      throw new Error(body?.error || "No palette was generated. Press Enter to try again.");
    if (!alive) return;
    // The particles always get their moment, even when the answer is instant.
    if (animated) await wait(Math.max(0, 3000 - (performance.now() - began)));
    if (!alive) return;
    phase.value = "reveal";
    await atelier?.reveal(palette);
    if (!alive) return;
    current.value = { text, ...palette };
    shown.value++;
    input.value = "";
    handoff.value = false;
  } catch {
    controller.abort();
    if (!alive) return;
    reset();
  } finally {
    if (alive) {
      phase.value = "idle";
      await nextTick();
      if (fine.value) focus();
    }
  }
}

async function copy(color: string) {
  try {
    await navigator.clipboard.writeText(color);
    copied.value = color;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied.value = ""), 1400);
  } catch {}
}

watch(phase, (_, before) => presentCaption(before === "reveal" ? 1100 : 0));
watch(current, () => void nextTick(drawLabels));
watch(
  () => !input.value && !busy.value,
  () => presentInvite(),
);
watch(input, () => {
  void warmFonts(input.value);
  presentCaption();
});
watch(
  () => !!input.value || busy.value,
  (on) => atelier?.setScrim(on),
);
watch(busy, () => {
  // Refresh the writing layer after generation releases it.
  if (!busy.value) void nextTick(() => layoutWriting(true));
});
const phases: Record<VoiceState, VoicePhase> = {
  idle: "off",
  permission: "waiting",
  recording: "listening",
  sending: "heard",
};
watch(voiceState, (state) => {
  atelier?.setVoice(phases[state], voicePoint.x, voicePoint.y);
  if (state !== "idle" && !input.value) presentInvite(0);
  if (state !== "recording") unfollow();
});
watch(chars, () => layoutWriting(), { flush: "post" });
watch(focused, () => drawWriting());
watch(ink, () => atelier?.setInk(ink.value));
watch(stops, brand, { immediate: true });

onMounted(() => {
  stopViewport = trackViewport();
  stopFonts = onFontsReady(refit);
  const openingAt = performance.now() + 1100;
  const openingFonts = Promise.race([
    warmFonts(copyText.invite + current.value.text),
    new Promise<void>((resolve) => {
      openingFontTimer = setTimeout(resolve, 1800);
    }),
  ]).finally(() => clearTimeout(openingFontTimer));
  fine.value = matchMedia("(pointer: fine)").matches;
  voiceSupported = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  const degrade = () => {
    atelier?.dispose();
    atelier = undefined;
    fallback.value = true;
  };
  try {
    // Each example shows in its own liquid; ?material=<name> keeps one throughout.
    const asked = new URLSearchParams(location.search).get("material");
    const material = asked ? parseMaterial(asked) : (current.value.material ?? "silk");
    atelier = new Atelier(canvas.value!, current.value, degrade, material, !!asked);
    if (debug) {
      const locked = asked ? " (locked)" : "";
      liquid.value = material + locked;
      atelier.onLiquid = (showing, arriving) =>
        (liquid.value = (arriving ? `${showing} → ${arriving}` : showing) + locked);
    }
    atelier.setInk(ink.value);
    const rect = canvas.value!.getBoundingClientRect();
    width = Math.round(rect.width);
    height = Math.round(rect.height);
    atelier.resize(rect.width, rect.height);
    void openingFonts
      .then(() => nextTick())
      .then(() => {
        if (!alive) return;
        drawLabels();
        const delay = Math.max(0, openingAt - performance.now());
        presentCaption(delay);
        presentInvite(delay);
      });
  } catch (cause) {
    console.error("Color renderer unavailable:", cause);
    degrade();
  }
  resizer = new ResizeObserver(([entry]) => {
    width = Math.round(entry.contentRect.width);
    height = Math.round(entry.contentRect.height);
    atelier?.resize(width, height);
    void nextTick(() => {
      drawLabels();
      layoutWriting();
    });
  });
  resizer.observe(canvas.value!);
  // Follow strip expansion and viewport padding so the painted caption stays with its controls.
  follower = new ResizeObserver(() => {
    const box = corner.value?.querySelector(".caption")?.getBoundingClientRect();
    if (box) atelier?.moveLabel("caption", box.left - captionAt.left, box.top - captionAt.top);
  });
  follower.observe(corner.value!, { box: "border-box" });
  window.addEventListener("keydown", keys);
  window.addEventListener("blur", cancelVoice);
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("selectionchange", selected);
  if (fine.value) focus();
});

onUnmounted(() => {
  alive = false;
  clearTimeout(holdTimer);
  clearTimeout(cancelTimer);
  voice.cancel();
  unfollow();
  stopViewport?.();
  stopFonts?.();
  request?.abort();
  resizer?.disconnect();
  follower?.disconnect();
  atelier?.dispose();
  clearTimeout(copyTimer);
  clearTimeout(captionTimer);
  clearTimeout(inviteTimer);
  clearTimeout(openingFontTimer);
  window.removeEventListener("keydown", keys);
  window.removeEventListener("blur", cancelVoice);
  document.removeEventListener("visibilitychange", visibility);
  document.removeEventListener("selectionchange", selected);
});
</script>

<template>
  <main
    :class="{ fallback }"
    :data-phase="phase"
    :style="{
      '--ink': ink,
      '--selection': `${ink}3d`,
      '--serif': serif,
      '--cancel-duration': `${cancelDuration}ms`,
      background: fallback ? paint : undefined,
    }"
    @pointerdown.capture="beginVoice"
    @pointermove="moveVoice"
    @pointerup="releaseVoice"
    @pointercancel="cancelVoicePointer"
    @lostpointercapture="cancelVoicePointer"
    @contextmenu="voiceContext"
    @click="tap"
  >
    <canvas
      ref="canvas"
      class="canvas"
      role="img"
      :aria-label="`${current.text}: ${current.colors.join(', ')}`"
    />
    <div v-if="debug && liquid" class="liquid" aria-hidden="true">
      <span>{{ liquid }}</span>
      <span class="row">
        <button v-for="name in liquids" :key="name" type="button" @click.stop="showLiquid(name)">
          {{ name }}
        </button>
      </span>
      <span class="row">
        <button
          v-for="mode in arrivals"
          :key="mode"
          type="button"
          :class="{ on: arrival === mode }"
          @click.stop="chooseArrival(mode)"
        >
          {{ mode }}
        </button>
      </span>
    </div>

    <form
      class="stage"
      :class="{ dissolved: handoff, cancelled: cancelling }"
      :aria-busy="busy"
      @submit.prevent="submit()"
    >
      <div ref="words" class="words" :style="{ lineHeight: leading }">
        <div ref="mirror" class="mirror" aria-hidden="true">
          <span v-for="(char, i) in chars" :key="i" class="ch">{{ char }}</span
          >&#8203;
        </div>
        <textarea
          ref="editor"
          :value="input"
          :aria-label="copyText.input"
          :style="{ caretColor: fallback && input ? 'var(--ink)' : 'transparent' }"
          :disabled="locked"
          :spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          enterkeyhint="go"
          rows="1"
          @input="write"
          @compositionstart="composing = true"
          @compositionend="composed"
          @keydown="enter"
          @focus="focused = true"
          @blur="focused = false"
        />
      </div>
      <p ref="hint" class="invite" :class="{ hidden: input || busy }" aria-hidden="true">
        <span
          ><span v-for="(char, i) in invite" :key="i" class="ch">{{ char }}</span></span
        >
      </p>
      <button class="sr-only" type="submit" :disabled="locked || !input.trim()">
        {{ copyText.generate }}
      </button>
    </form>

    <footer
      ref="corner"
      :class="{ quiet: input }"
      @click.stop="!fine && editor?.blur()"
      @pointerenter="ring(false)"
      @pointerleave="ring(true)"
    >
      <template v-for="entry in [current]" :key="shown">
        <button
          class="caption"
          type="button"
          :disabled="locked || !!input"
          :aria-label="copyText.nextExample"
          aria-keyshortcuts="ArrowLeft ArrowUp ArrowRight ArrowDown"
          @keydown.enter.prevent
          @keydown.space.prevent
          @click.stop="changeExample()"
        >
          <span v-for="(char, i) in graphemes(entry.text)" :key="i" class="ch">{{ char }}</span>
        </button>
        <div class="strip" :class="{ active: copied }" :style="{ '--n': entry.colors.length }">
          <button
            v-for="(color, i) in entry.colors"
            :key="i"
            type="button"
            class="swatch"
            :class="{ copied: copied === color }"
            :style="{
              '--c': color,
              '--fg': foreground(color),
              '--i': i,
              '--swatch-width': entry.weights && `${entry.weights[i] * entry.colors.length * 30}px`,
            }"
            :aria-label="copyText.copy(color)"
            @click="copy(color)"
          >
            <span class="hex">{{ color }}</span>
            <svg class="tick" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.5 8.4 6.6 11.4 12.5 4.8" />
            </svg>
          </button>
        </div>
      </template>
    </footer>

    <span class="sr-only" role="status">{{ voiceStatus }}</span>
    <span class="sr-only" role="status">{{
      busy
        ? copyText.thinking
        : copied
          ? copyText.copied(copied)
          : copyText.palette(current.text, current.colors.length)
    }}</span>
  </main>
</template>

<style>
.liquid {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 10;
  display: grid;
  gap: 4px;
  padding: 5px 7px;
  border-radius: 4px;
  background: rgb(0 0 0 / 0.45);
  color: #fff;
  font:
    11px/1.3 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}

.liquid .row {
  display: flex;
  gap: 4px;
}

.liquid button {
  padding: 1px 5px;
  border: 1px solid rgb(255 255 255 / 0.35);
  border-radius: 3px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.liquid button.on {
  background: rgb(255 255 255 / 0.25);
}

@property --ink {
  syntax: "<color>";
  inherits: true;
  initial-value: #ffffff;
}
* {
  box-sizing: border-box;
}
html,
body,
#app {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
  touch-action: none;
  background: #000;
}
body {
  font-family:
    -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif;
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}
main {
  --page-height: 100vh;
  position: relative;
  width: 100%;
  height: var(--page-height);
  overflow: hidden;
  color: var(--ink);
  cursor: text;
  isolation: isolate;
  transition: --ink 1.2s ease;
}
@supports (height: 100svh) {
  main {
    --page-height: 100svh;
  }
}
main[data-phase="thinking"],
main[data-phase="reveal"] {
  cursor: progress;
}
/* With WebGL the painting draws its own pointer, a fine ring tinted by what it passes over. The
   corner keeps the system cursor for its controls. */
main:not(.fallback),
main:not(.fallback) textarea {
  cursor: none;
}
.canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.fallback .canvas {
  visibility: hidden;
}
button:focus-visible {
  outline: 1.5px solid var(--ink);
  outline-offset: 3px;
}

.stage {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}
.words {
  position: relative;
  width: min(84vw, 1100px);
  font-family: var(--serif);
  font-weight: 380;
  font-size: clamp(20px, 10vw, 84px);
  font-feature-settings: "palt";
  letter-spacing: 0.05em;
  text-align: center;
}
.mirror,
textarea {
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: normal;
  /* Keep earlier lines stable while typing; the textarea and mirror use the same flow. */
  text-wrap: wrap;
}
/* Laid out here but drawn by the painting, in its own ink. Without WebGL the text shows itself. */
.mirror {
  color: transparent;
}
.fallback .mirror {
  color: var(--ink);
  transition:
    opacity var(--cancel-duration) ease,
    filter var(--cancel-duration) ease;
}
.fallback .cancelled .mirror {
  opacity: 0;
  filter: blur(6px);
}
.dissolved .mirror {
  opacity: 0;
}
/* Without WebGL, each typed character inks in. */
.fallback .mirror .ch {
  position: relative;
  animation: ink 0.7s cubic-bezier(0.2, 0.7, 0.1, 1) both;
}
textarea {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  outline: 0;
  resize: none;
  overflow: hidden;
  background: none;
  font: inherit;
  letter-spacing: inherit;
  text-align: inherit;
  color: transparent;
  -webkit-text-fill-color: transparent;
  text-shadow: none;
  pointer-events: auto;
}
textarea:disabled {
  caret-color: transparent;
}
textarea::selection {
  background: transparent;
}
.fallback textarea::selection {
  background: var(--selection);
}
/* The hint: a quiet invitation to write, small and still. It steps aside the moment anything is
   written and comes back, unhurried, once the painting has settled. */
.invite {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  font: 300 clamp(19px, 1.9vw, 24px) / 1 var(--serif);
  font-feature-settings: "palt";
  letter-spacing: 0.24em;
  text-indent: 0.24em;
  white-space: nowrap;
  /* Laid out here but drawn by the painting, like the caption. */
  color: transparent;
  pointer-events: none;
}
html:not([lang="zh-CN"]):not([lang="ja"]):not([lang="ko"]) .invite {
  padding-inline: 20px;
  font-size: clamp(15px, 4vw, 24px);
  letter-spacing: 0.04em;
  text-indent: 0.04em;
}
html[lang="ja"] .invite,
html[lang="ko"] .invite {
  padding-inline: 20px;
  font-size: clamp(16px, 4.2vw, 24px);
  letter-spacing: 0.08em;
  text-indent: 0.08em;
}
/* Without WebGL: differenced with the page, so it reads on dark and light alike. */
.fallback .invite {
  color: #fff;
  mix-blend-mode: difference;
  opacity: 0.6;
  animation: arrive 2.4s 1.1s both;
  transition:
    opacity 1.2s ease 1.6s,
    filter 1.2s ease 1.6s;
}
.fallback .invite.hidden {
  opacity: 0;
  filter: blur(6px);
  transition-duration: 0.4s;
  transition-delay: 0s;
}

/* The corner holds what was written and its colors, like a label beside a painting. */
footer {
  position: absolute;
  inset: auto auto 0 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  max-width: min(44vw, 420px);
  /* In-app browser controls can cover part of the page. Growing the padding also lets
     the corner's ResizeObserver keep its painted caption aligned with the controls. */
  padding: 0 26px
    calc(
      max(24px, env(safe-area-inset-bottom)) +
        max(0px, var(--page-height) - var(--viewport-bottom, var(--page-height)))
    );
  cursor: default;
}
footer.quiet .strip {
  opacity: 0.3;
}
/* Hidden while the words come apart and while the new colors flow in; the new label
   appears only once the painting has settled. (The caption is faded by the painting.) The
   colors sink back one by one in reading order, as the words do, and the capsule goes last. */
main[data-phase="thinking"] .strip,
main[data-phase="reveal"] .strip {
  /* Leaving, left to right too: the left end draws in toward the right, rim and all, while the
     right end stays where it was, so the colors go one by one in reading order, as the words
     do. Nothing of the capsule outlasts its last color. */
  width: 0;
  transform: translateX(calc(var(--n) * 30px));
  justify-content: flex-end;
  pointer-events: none;
  transition:
    width calc(var(--n) * 70ms + 0.25s) cubic-bezier(0.55, 0, 0.75, 0.3),
    transform calc(var(--n) * 70ms + 0.25s) cubic-bezier(0.55, 0, 0.75, 0.3),
    opacity 0.15s ease calc(var(--n) * 70ms + 0.15s);
  opacity: 0;
}
.caption {
  display: -webkit-box;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  font: 400 15px/1.6 var(--serif);
  font-feature-settings: "palt";
  letter-spacing: 0.08em;
  /* Laid out here but drawn by the painting, black or white stroke by stroke. Without WebGL
     the text shows itself in the page's ink. */
  color: transparent;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.caption:disabled {
  cursor: default;
}
.fallback .caption {
  color: var(--ink);
}
/* One continuous capsule of the palette. Over it, the capsule opens up and the color under the
   pointer widens to show its value; a click copies it and draws a tick in its place. */
.strip {
  position: relative;
  display: flex;
  width: calc(var(--n) * 30px);
  height: 12px;
  border-radius: 6px;
  overflow: hidden;
  /* Keeps the rounded clip intact while it animates (Safari). */
  isolation: isolate;
  box-shadow: 0 10px 24px -12px rgb(0 0 0 / 0.45);
  /* Arriving, the capsule grows from the left with its colors: its rounded end, rim and shadow
     travel with the leading edge, uncovering one color after another, so there is never an
     empty frame waiting for them. */
  animation: grow calc(var(--n) * 90ms + 0.35s) cubic-bezier(0.3, 0.6, 0.2, 1) 1.3s backwards;
  transition:
    opacity 0.5s ease,
    transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1),
    width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1),
    height 0.6s cubic-bezier(0.2, 0.8, 0.2, 1),
    border-radius 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
}
/* A soft rim instead of an outline: a faint light edge with a touch of sheen on top and shade
   below, so the capsule reads as one smooth piece of glass on any color. */
.strip::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow:
    inset 0 0 0 0.5px rgb(255 255 255 / 0.2),
    inset 0 1px 1px rgb(255 255 255 / 0.16),
    inset 0 -1px 1px rgb(0 0 0 / 0.1);
  pointer-events: none;
}
.strip:hover,
.strip:focus-within,
.strip.active {
  width: calc(var(--n) * 30px + 92px);
  height: 30px;
  border-radius: 15px;
}
.swatch {
  position: relative;
  display: grid;
  place-items: center;
  flex: 1 1 0;
  /* Never narrower than at rest: while the capsule grows or draws in, it uncovers the colors
     rather than squeezing them. */
  min-width: var(--swatch-width, 30px);
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  color: var(--fg);
  background: var(--c);
  /* Bleeds a pixel into the next color so fractional widths never open a hairline seam. */
  box-shadow: 1px 0 0 var(--c);
  cursor: copy;
  /* Each color brightens into place as the growing edge reaches it. */
  animation: tint 0.5s ease calc(1.3s + var(--i) * 80ms) backwards;
  transition: flex-grow 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.swatch:hover,
.swatch:focus-visible,
.swatch.copied {
  flex-grow: 4;
}
.strip:is(:hover, :focus-within, .active) .swatch {
  min-width: 30px;
}
.swatch:focus-visible {
  outline: none;
  box-shadow:
    inset 0 0 0 1.5px var(--fg),
    1px 0 0 var(--c);
}
.hex,
.tick {
  grid-area: 1 / 1;
  opacity: 0;
  transition: opacity 0.25s ease;
}
.hex {
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
html:is([lang="zh-CN"], [lang="ja"], [lang="ko"]) .hex {
  font-family: "Geist UI", var(--serif);
}
.swatch:is(:hover, :focus-visible) .hex {
  opacity: 0.85;
  transition-delay: 0.2s;
}
.tick {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 14;
  stroke-dashoffset: 14;
}
.swatch.copied .hex {
  opacity: 0;
  transition-delay: 0s;
}
.swatch.copied .tick {
  opacity: 1;
  animation: tick 0.45s cubic-bezier(0.3, 0.7, 0.3, 1) 0.05s forwards;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@keyframes grow {
  from {
    width: 0;
  }
}
@keyframes tint {
  from {
    opacity: 0.4;
    filter: saturate(0.5) brightness(1.12);
  }
}
@keyframes tick {
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes arrive {
  from {
    opacity: 0;
    filter: blur(12px);
    transform: translateY(10px);
  }
}
@keyframes ink {
  from {
    top: 0.32em;
    color: transparent;
    text-shadow: 0 0 0.45em var(--ink);
  }
  55% {
    text-shadow: 0 0 0.1em var(--ink);
  }
}

/* Keep the mobile editor above the keyboard without moving the painting on focus. */
@media (pointer: coarse) {
  .stage {
    inset-block-end: 50%;
  }
}

@media (max-width: 600px) {
  footer {
    max-width: 72vw;
    padding-inline: 18px;
  }
  .caption {
    font-size: 14px;
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
  }
}
</style>
