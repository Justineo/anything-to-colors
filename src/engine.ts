import { hexToOklab, hexToRgb } from "./color";
import { Fluid, STRIDE, pointArray, type FieldState, type Flow, type Label } from "./fluid";
import { createProgram, type Program } from "./gl";
import {
  WRITING_CONTRAST,
  pointFragment,
  pointVertex,
  wordsFragment,
  wordsVertex,
  writingFragment,
  writingVertex,
} from "./shaders";
import { Swarm } from "./swarm";
import { MATERIALS, between as partway, type Material, type MaterialStyle } from "./materials";

export type Glyph = { char: string; left: number; top: number; width: number; height: number };

/** The corner caption, and the hint in the middle that softens out of focus as it leaves. */
// Contrast is APCA Lc: enough for the short caption to read while leaving the ink room to
// stay colorful; the hint is meant to stay quiet.
const LABELS = {
  caption: { slot: 0, rise: 2.4, fall: 2.4, blur: 0, contrast: 0.4 },
  invite: { slot: 1, rise: 1.8, fall: 7, blur: 6, contrast: 0.3 },
};
export type LabelName = keyof typeof LABELS;

/** Waiting for the microphone, hearing a voice, or holding still until its words arrive. */
export type VoicePhase = "off" | "waiting" | "listening" | "heard";

type Box = [number, number, number, number];
type View = Parameters<Fluid["display"]>[2];
/** A character being written: where it sits in the raster, where it is gliding, when it arrived. */
type Written = { char: string; source: Box; from: Box; to: Box; moved: number; born: number };
/** Where the caret stands, in css px, and which characters are selected (grapheme indices). */
export type Caret = { left: number; top: number; height: number; selection: [number, number] };
// How long a character takes to condense out of the paint, and to glide when the lines reflow.
const ARRIVE = 0.75;
const GLIDE = 0.45;
export const cancelDuration = 280;
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);
const between = (a: Box, b: Box, t: number): Box => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
  a[3] + (b[3] - a[3]) * t,
];
/** A label easing toward how present it should be; `peak` is the last level it was shown at. */
type Shown = Label & { target: number; peak: number; origin: [number, number] };

const TAU = Math.PI * 2;
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const approach = (value: number, target: number, rate: number, dt: number) =>
  value + (target - value) * (1 - Math.exp(-rate * dt));

// Small integer-hash value noise; only used to rough up the erosion front.
function hash(x: number, y: number) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
/** The nearest seed of a jittered lattice of unit cells: where it sits, and a random value of its own. */
function shardOf(x: number, y: number): [number, number, number] {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  let best = Infinity,
    bx = x,
    by = y,
    id = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i + 0.1 + 0.8 * hash(ix + i, iy + j),
        cy = iy + j + 0.1 + 0.8 * hash(iy + j + 7919, ix + i);
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < best) {
        best = d;
        bx = cx;
        by = cy;
        id = hash(ix + i + 104729, iy + j);
      }
    }
  return [bx, by, id];
}
function noise(x: number, y: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const u = smooth(x - ix),
    v = smooth(y - iy);
  const top = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * u;
  const bottom = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * u;
  return top + (bottom - top) * v;
}

// Premultiplied, so glyphs' soft edges filter without dark fringes.
function premultiply(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    data[i] = Math.round(data[i] * a);
    data[i + 1] = Math.round(data[i + 1] * a);
    data[i + 2] = Math.round(data[i + 2] * a);
  }
}

function flatten(colors: string[]) {
  const data = new Float32Array(27);
  for (let i = 0; i < 9; i++) data.set(hexToOklab(colors[Math.min(i, colors.length - 1)]), i * 3);
  return data;
}

/**
 * Orchestrates the living canvas: a fluid of pigment that always relaxes toward
 * the current palette, the words' particles, and the transitions between them.
 */
export class Atelier {
  private gl: WebGL2RenderingContext;
  private fluid: Fluid;
  private swarm: Swarm;
  private points: Program;
  private pointVao: WebGLVertexArrayObject;
  private pointBuffer: WebGLBuffer;
  private words: Program;
  private wordsVao: WebGLVertexArrayObject;
  private wordsBuffer: WebGLBuffer;
  private glyphs: WebGLTexture;
  private order: WebGLTexture;
  private writing: Program;
  private writingVao: WebGLVertexArrayObject;
  private writingBuffers: WebGLBuffer[];
  /** The words being written, drawn in ink by the GL; the DOM only lays them out. */
  private written = {
    texture: null as unknown as WebGLTexture,
    size: [1, 1] as [number, number],
    glyphs: [] as Written[],
    caret: null as Caret | null,
    caretBox: [0, 0, 0, 0] as Box,
    caretFrom: [0, 0, 0, 0] as Box,
    caretMoved: -1e9,
    changed: -1e9,
    presence: 0,
    hidden: false,
    cancelledAt: undefined as number | undefined,
  };
  private labels: [Shown, Shown];
  private wordsRect?: [number, number, number, number];
  private shown?: () => void;
  private burstAt = -1e9;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private frame = 0;
  private last = 0;
  private time = 0;
  private disposed = false;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)");
  /** The liquid showing, and the settings in force this frame (between two during a change). */
  private material: Material;
  private style: MaterialStyle;
  /**
   * A change of liquid under way, from the one showing to the one arriving with the new palette,
   * and when it began; it is complete when the palette settles.
   */
  private shift?: { from: Material; to: Material; start: number };
  /**
   * How a new palette (and liquid) comes in: spreading out from where the words' paint landed,
   * or as a tide flooding out from where the words fell.
   */
  arrival: "bloom" | "tide" = "bloom";
  /** Where the words' paint has landed during this palette change, summed: a tide's source. */
  private landed: [number, number, number] = [0, 0, 0];
  /** Told whenever the liquid changes: the one showing, and the one arriving while it soaks in. */
  onLiquid?: (showing: Material, arriving?: Material) => void;
  /** Where the light stands, in uv with y up: over the pointer, or wandering on its own. */
  private light = { x: 0.22, y: 0.8 };
  private field: FieldState;
  private key = "";
  private transition?: { start: number; duration: number };
  private ink = "#ffffff";
  private scrim = 0;
  private scrimTarget = 0;
  /** The hollow behind the words: dark under light ink, light under dark ink. Eased, never switched. */
  private scrimLightness = -1;
  private scrimTone = 0.2;
  private swirl = 0;
  private swirlTarget = 0;
  private fade = 0;
  /** The fluid's currents in screen terms, so the words' particles move with the paint. */
  private flow: Flow = (x, y, out) => this.fluid.flowAt(x, y, this.width, this.height, out);
  private pointer = { x: -1e4, y: -1e4, dx: 0, dy: 0, moved: false, down: false };
  /**
   * The fingertip the pointer draws through the liquid: it follows the hand on a spring, and is
   * in the liquid while the mouse is over the page or a finger is down.
   */
  private probe = { x: 0, y: 0, vx: 0, vy: 0, in: false, still: 0 };
  /** Points handed to the fluid this frame: the pushes of drops opening into rings, and the milk they carry. */
  private marks = new Float32Array(256 * STRIDE);
  private blobs = new Float32Array(512 * STRIDE);
  /** Drops opening on a film: each a ring, thin in the middle and thick at its rim, spreading. */
  private rings: { x: number; y: number; start: number; size: number }[] = [];
  /**
   * The mouse pointer, drawn into the painting as a small ring: shown once the mouse moves,
   * gone while typing, outside the window or over the page's own controls.
   */
  private ring = { alpha: 0, speed: 0, travel: 0, press: 0, seen: false, away: false };
  /** A voice being heard, drawn where the finger rests; see setVoice. */
  private voice = {
    phase: "off" as VoicePhase,
    x: 0,
    y: 0,
    presence: 0,
    level: 0,
    heard: 0,
    reach: 0,
    ripple: 0,
    swirl: 0,
    time: 0,
  };

  constructor(
    private canvas: HTMLCanvasElement,
    colors: string[],
    private unavailable: () => void,
    material: Material = "silk",
    /** Keeps this liquid whatever the examples ask for (for trying one out). */
    private locked = false,
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this.material = material;
    this.style = MATERIALS[material];
    this.fluid = new Fluid(gl, this.style);
    this.fluid.materials = [this.style.id, this.style.id];
    this.points = createProgram(gl, pointVertex, pointFragment);
    [this.pointVao, this.pointBuffer] = pointArray(gl);
    this.words = createProgram(gl, wordsVertex, wordsFragment);
    this.wordsVao = gl.createVertexArray()!;
    this.wordsBuffer = gl.createBuffer()!;
    gl.bindVertexArray(this.wordsVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.wordsBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    // One quad per character being written (and one for the caret), instanced.
    this.writing = createProgram(gl, writingVertex, writingFragment);
    this.writingVao = gl.createVertexArray()!;
    this.writingBuffers = [gl.createBuffer()!, gl.createBuffer()!];
    gl.bindVertexArray(this.writingVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.writingBuffers[0]);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.writingBuffers[1]);
    for (const [location, size, offset] of [
      [1, 4, 0],
      [2, 4, 4],
      [3, 3, 8],
    ]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 11 * 4, offset * 4);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
    const [glyphs, order, caption, invite, written] = [0, 1, 2, 3, 4].map(() => {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      for (const [key, value] of [
        [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
        [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
        [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      ])
        gl.texParameteri(gl.TEXTURE_2D, key, value);
      // The painting can render before font loading supplies the text textures.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return texture;
    });
    this.glyphs = glyphs;
    this.order = order;
    this.written.texture = written;
    this.labels = Object.values(LABELS).map(({ contrast }, slot) => ({
      texture: [caption, invite][slot],
      rect: [0, 0, 0, 0],
      alpha: 0,
      target: 0,
      peak: 1,
      origin: [0, 0],
      blur: 0,
      contrast,
    })) as typeof this.labels;
    const small = Math.min(innerWidth, innerHeight) < 600;
    this.swarm = new Swarm(small ? 3200 : 7000);
    this.swarm.style = this.style.particle;
    const palette = flatten(colors);
    this.key = colors.join();
    this.field = {
      paletteA: palette,
      paletteB: palette,
      countA: colors.length,
      countB: colors.length,
      mix: 0,
      time: Math.random() * 100,
      aspect: 1,
      spread: false,
    };
    if (this.reduced.matches) this.fade = 1;
    canvas.addEventListener("webglcontextlost", this.lost);
    document.addEventListener("visibilitychange", this.wake);
    window.addEventListener("pointermove", this.move, { passive: true });
    window.addEventListener("pointerdown", this.press, { passive: true });
    window.addEventListener("pointerup", this.release, { passive: true });
    window.addEventListener("pointerout", this.leave, { passive: true });
    window.addEventListener("keydown", this.typing, { passive: true });
    this.reduced.addEventListener("change", this.wake);
  }

  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.ratio = Math.min(
      devicePixelRatio || 1,
      2,
      Math.sqrt(3_200_000 / (this.width * this.height)),
    );
    this.canvas.width = Math.round(this.width * this.ratio);
    this.canvas.height = Math.round(this.height * this.ratio);
    this.field.aspect = this.width / this.height;
    const long = Math.max(this.canvas.width, this.canvas.height);
    this.fluid.page = this.width;
    this.fluid.resize(
      this.field.aspect,
      Math.min(long * 0.6, Math.min(this.width, this.height) < 600 ? 720 : 1280),
      this.field,
    );
    this.wake();
  }

  /** Light ink means a dark painting: keep a darker hollow behind the words, and vice versa. */
  setInk(hex: string) {
    const rgb = hexToRgb(hex);
    const light = rgb[0] > 0.5;
    this.ink = hex;
    this.swarm.glow = light ? 0.55 : 0;
    this.scrimTone = light ? 0.16 : 0.94;
    if (this.scrimLightness < 0) this.scrimLightness = this.scrimTone;
    this.wake();
  }

  setScrim(on: boolean) {
    this.scrimTarget = on ? 1 : 0;
    this.wake();
  }

  private setPalette(colors: string[]) {
    const key = colors.join();
    if (key === this.key) return;
    this.key = key;
    if (this.transition) this.settle();
    this.field.paletteB = flatten(colors);
    this.field.countB = colors.length;
    this.field.mix = 0;
    if (this.reduced.matches) {
      this.settle();
      this.wake();
      return;
    }
    // The new colors spread out from where the words' paint lands, then fill in what they have
    // not reached, then settle.
    this.transition = { start: performance.now(), duration: 7500 };
    this.field.spread = true;
    this.landed = [0, 0, 0];
    this.fluid.beginSpread();
    this.wake();
  }

  private settle() {
    this.field.paletteA = this.field.paletteB;
    this.field.countA = this.field.countB;
    this.field.mix = 0;
    this.field.spread = false;
    this.transition = undefined;
    this.arrive();
    this.fluid.endSpread(this.style.id);
  }

  /** Draws glyphs at their on-screen places into a device-resolution canvas around them. */
  private rasterize(glyphs: Glyph[], font: string, fill: string, pad: number) {
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const glyph of glyphs) {
      left = Math.min(left, glyph.left);
      top = Math.min(top, glyph.top);
      right = Math.max(right, glyph.left + glyph.width);
      bottom = Math.max(bottom, glyph.top + glyph.height);
    }
    left = Math.max(0, Math.floor(left - pad));
    top = Math.max(0, Math.floor(top - pad));
    const width = Math.min(Math.ceil(right + pad), Math.ceil(this.width)) - left;
    const height = Math.min(Math.ceil(bottom + pad), Math.ceil(this.height)) - top;
    if (width <= 0 || height <= 0) return null;
    const ratio = this.ratio;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * ratio);
    canvas.height = Math.ceil(height * ratio);
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.scale(ratio, ratio);
    // Baseline measurements need only H/g, not the complete Western font.
    context.font = font.replace('"Geist Serif"', '"Geist UI"');
    context.fillStyle = fill;
    const metrics = context.measureText("国Hg");
    context.font = font;
    const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
    for (const glyph of glyphs)
      context.fillText(
        glyph.char,
        glyph.left - left,
        glyph.top - top + (glyph.height - ascent - descent) / 2 + ascent,
      );
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return { canvas, data, left, top, right, ratio };
  }

  private uploadGlyphs(texture: WebGLTexture, canvas: HTMLCanvasElement, data: ImageData["data"]) {
    premultiply(data);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      canvas.width,
      canvas.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
  }

  /**
   * The words being written, laid out by the DOM. Characters that were already there keep their
   * arrival and glide from where they are now to where the new layout puts them; new ones
   * condense out of the paint. `settled` skips the arrival, for words that are already showing.
   */
  setWriting(glyphs: Glyph[], font: string, caret: Caret | null, settled = false) {
    const now = performance.now() / 1000;
    const state = this.written;
    state.hidden = false;
    state.cancelledAt = undefined;
    state.changed = now;
    const drawn = glyphs.length ? this.rasterize(glyphs, font, "#fff", 4) : null;
    const before = state.glyphs;
    let head = 0;
    while (head < before.length && head < glyphs.length && before[head].char === glyphs[head].char)
      head++;
    let tail = 0;
    while (
      tail < before.length - head &&
      tail < glyphs.length - head &&
      before[before.length - 1 - tail].char === glyphs[glyphs.length - 1 - tail].char
    )
      tail++;
    state.glyphs = glyphs.map((glyph, i) => {
      const to: Box = [glyph.left, glyph.top, glyph.width, glyph.height];
      const source: Box = drawn
        ? [glyph.left - drawn.left, glyph.top - drawn.top, glyph.width, glyph.height]
        : to;
      const old =
        i < head
          ? before[i]
          : i >= glyphs.length - tail
            ? before[before.length - (glyphs.length - i)]
            : undefined;
      if (!old)
        return { char: glyph.char, source, from: to, to, moved: -1e9, born: settled ? -1e9 : now };
      return {
        char: glyph.char,
        source,
        from: this.place(old, now),
        to,
        moved: now,
        born: old.born,
      };
    });
    if (drawn) {
      const { canvas, data, ratio } = drawn;
      this.uploadGlyphs(state.texture, canvas, data);
      state.size = [canvas.width / ratio, canvas.height / ratio];
    }
    if (caret) {
      const width = Math.max(1.25, caret.height * 0.028);
      const box: Box = [
        caret.left - width / 2,
        caret.top + caret.height * 0.1,
        width,
        caret.height * 0.8,
      ];
      state.caretFrom = state.caret && state.presence > 0.05 ? this.caretAt(now) : box;
      state.caretBox = box;
      state.caretMoved = now;
    }
    state.caret = caret;
    this.wake();
  }

  private place(glyph: Written, now: number): Box {
    return between(glyph.from, glyph.to, easeOut((now - glyph.moved) / GLIDE));
  }

  private caretAt(now: number): Box {
    const state = this.written;
    return between(state.caretFrom, state.caretBox, easeOut((now - state.caretMoved) / 0.14));
  }

  /**
   * Words drawn by the display shader so every stroke pixel can take a deep or pale shade of
   * the paint behind it. Strokes are drawn white to mark them as ink; emoji keep color.
   */
  setLabel(name: LabelName, glyphs: Glyph[], font: string) {
    const { slot, blur } = LABELS[name];
    const label = this.labels[slot];
    const drawn = glyphs.length ? this.rasterize(glyphs, font, "#fff", 2 + blur) : null;
    if (!drawn) {
      label.rect = [0, 0, 0, 0];
      return;
    }
    const { canvas, data, left, top, ratio } = drawn;
    this.uploadGlyphs(label.texture, canvas, data);
    label.rect = [left, top, canvas.width / ratio, canvas.height / ratio];
    label.origin = [left, top];
    this.wake();
  }

  /** Show (or let go of) a voice being heard at a point, in css px. */
  setVoice(phase: VoicePhase, x?: number, y?: number) {
    const voice = this.voice;
    if (phase !== "off" && voice.phase === "off") {
      voice.level = voice.heard = voice.reach = 0;
    }
    if (x !== undefined && y !== undefined) {
      voice.x = x;
      voice.y = y;
    }
    voice.phase = phase;
    this.wake();
  }

  /** How loud the voice is right now, 0 to 1. */
  hear(level: number) {
    this.voice.level = Math.max(this.voice.level, Math.min(1, level));
  }

  /** How far the finger has strayed toward letting the voice go, 0 to 1. */
  stray(reach: number) {
    this.voice.reach = Math.min(1, Math.max(0, reach));
  }

  /** Whether the pointer ring may show: off over the page's own controls, which keep their cursor. */
  showRing(on: boolean) {
    this.ring.away = !on;
    this.wake();
  }

  /** Shift a label from where it was drawn, following its words as the layout around them moves. */
  moveLabel(name: LabelName, dx: number, dy: number) {
    const label = this.labels[LABELS[name].slot];
    label.rect[0] = label.origin[0] + dx;
    label.rect[1] = label.origin[1] + dy;
    this.wake();
  }

  /** How present a label is: 0 hidden, 1 fully there. */
  showLabel(name: LabelName, target: number) {
    const label = this.labels[LABELS[name].slot];
    label.target = target;
    if (target > 0) label.peak = target;
    this.wake();
  }

  /**
   * Take over the visible words: redraw them in GL at device resolution, then
   * erode them in reading order while each eroded pixel lifts off as a particle.
   * Resolves once the GL copy is on screen, so the DOM text can step aside.
   */
  dissolve(glyphs: Glyph[], font: string): Promise<boolean> {
    if (this.reduced.matches || !glyphs.length) return Promise.resolve(false);
    // Drawn in the ink the page uses; emoji bring their own colors.
    const drawn = this.rasterize(glyphs, font, this.ink, 6);
    if (!drawn) return Promise.resolve(false);
    const { canvas, data, left, top, right, ratio } = drawn;

    // Reading order, line by line, roughened by noise: that is the order the words come apart.
    const lines = [...new Set(glyphs.map((glyph) => Math.round(glyph.top)))].sort((a, b) => a - b);
    const lineHeight = glyphs[0].height;
    const span = right - left;
    // Some materials break apart in shards: every pixel of a shard shares its center's moment.
    const shard = this.style.shards;
    let low = Infinity,
      high = -Infinity,
      ink = 0;
    const order = new Float32Array(canvas.width * canvas.height);
    for (let py = 0; py < canvas.height; py++) {
      const row = top + py / ratio;
      for (let px = 0; px < canvas.width; px++) {
        let x = left + px / ratio,
          y = row,
          chip = 0.5;
        if (shard) {
          const [cx, cy, id] = shardOf(x / shard, y / shard);
          x = cx * shard;
          y = cy * shard;
          chip = id;
        }
        let line = lines.findIndex((start) => y < start + lineHeight);
        if (line < 0) line = lines.length - 1;
        const reading = (line + (x - left) / span) / lines.length;
        const rough = 0.65 * noise(x / 26, y / 26) + 0.35 * noise(x / 9 + 50, y / 9);
        const value = 0.75 * reading + 0.45 * (rough - 0.5) + 0.1 * (chip - 0.5);
        const index = py * canvas.width + px;
        order[index] = value;
        if (data[index * 4 + 3] > 110) {
          ink++;
          low = Math.min(low, value);
          high = Math.max(high, value);
        }
      }
    }
    if (!ink) return Promise.resolve(false);
    const threshold = new Uint8Array(order.length);
    for (let i = 0; i < order.length; i++)
      threshold[i] = Math.round(
        Math.min(1, Math.max(0, (order[i] - low) / (high - low + 1e-6))) * 255,
      );

    const grain = Math.max(1, Math.sqrt(ink / (ratio * ratio) / this.swarm.capacity));
    const step = Math.max(1, Math.round(grain * ratio));
    // Each particle carries its pixel's place, erosion threshold and color.
    const points = new Float32Array(this.swarm.capacity * 6);
    let count = 0;
    for (let py = 0; py < canvas.height && count < this.swarm.capacity; py += step)
      for (let px = 0; px < canvas.width && count < this.swarm.capacity; px += step) {
        const jx = Math.min(canvas.width - 1, px + Math.floor(Math.random() * step)),
          jy = Math.min(canvas.height - 1, py + Math.floor(Math.random() * step));
        const pixel = jy * canvas.width + jx;
        if (data[pixel * 4 + 3] > 110) {
          points.set(
            [
              left + (jx + 0.5) / ratio,
              top + (jy + 0.5) / ratio,
              threshold[pixel] / 255,
              data[pixel * 4] / 255,
              data[pixel * 4 + 1] / 255,
              data[pixel * 4 + 2] / 255,
            ],
            count * 6,
          );
          count++;
        }
      }

    this.uploadGlyphs(this.glyphs, canvas, data);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.order);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      canvas.width,
      canvas.height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      threshold,
    );
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.wordsRect = [left, top, canvas.width / ratio, canvas.height / ratio];
    // The GL copy takes over from the written words on this very frame.
    this.written.hidden = true;
    this.swarm.form(points, count, (step / ratio) * 1.15 + 0.5, this.width, this.height);
    this.swirlTarget = 1;
    this.wake();
    return new Promise((resolve) => (this.shown = () => resolve(true)));
  }

  /**
   * Recolor the particles and melt them into the fluid. The resting field follows the dye
   * rather than leading it: it starts late, moves slowly, and the fluid holds on to the
   * melted pigment longer while it is carried around. Resolves once the melting is under way.
   */
  reveal(colors: string[], material?: Material) {
    this.swarm.steep(colors.map(hexToOklab));
    this.swirlTarget = 0;
    // The words are gone by now: let the hollow behind them fill in with the new color.
    this.scrimTarget = 0;
    this.burstAt = performance.now();
    this.setPalette(colors);
    if (material && !this.locked) this.becomes(material);
    return new Promise<void>((resolve) => setTimeout(resolve, this.reduced.matches ? 0 : 1700));
  }

  /**
   * The new palette arrives in another liquid. It comes in with the new colors: wherever they
   * have spread from the words' paint the surface turns into the new liquid, while the liquid
   * itself changes over a few seconds and the particles take on their new form as they take
   * on their new color. Without a palette change under way it simply becomes the new liquid.
   */
  private becomes(material: Material) {
    const current: string = this.shift?.to ?? this.material;
    if (material === current) return;
    if (this.shift) this.arrive();
    this.shift = { from: this.material, to: material, start: this.time };
    this.fluid.materials = [MATERIALS[this.material].id, MATERIALS[material].id];
    this.fluid.pair = [MATERIALS[this.material], MATERIALS[material]];
    this.onLiquid?.(this.material, material);
    if (!this.transition) {
      this.arrive();
      this.fluid.endSpread(this.style.id);
    }
  }

  /** The new liquid has reached everywhere: it is simply the liquid now. */
  private arrive() {
    if (!this.shift) return;
    this.material = this.shift.to;
    this.shift = undefined;
    this.fluid.pair = undefined;
    this.style = MATERIALS[this.material];
    this.swarm.style = this.style.particle;
    this.fluid.style = this.style;
    this.onLiquid?.(this.material);
  }

  /** Settings for this frame, partway between liquids while one is arriving. */
  private blendStyles() {
    const shift = this.shift;
    if (!shift) return;
    const from = MATERIALS[shift.from],
      to = MATERIALS[shift.to];
    const since = this.time - shift.start;
    this.style = partway(from, to, smooth((since - 0.4) / 3.2));
    // The particles change as they take on their color, sooner than the liquid around them.
    this.swarm.style = partway(from.particle, to.particle, smooth(since / 0.9));
    this.fluid.style = this.style;
  }

  /** Let rejected words and the voice mark go quietly, without turning them into a palette. */
  cancelInput() {
    this.written.cancelledAt = performance.now() / 1000;
    this.written.caret = null;
    this.stray(1);
    this.setVoice("off");
    return this.reduced.matches ? 0 : cancelDuration;
  }

  /** Release failed input and its particles, leaving the current painting ready again. */
  reset() {
    this.swarm.mode = "idle";
    this.swarm.count = this.swarm.painted = 0;
    this.wordsRect = undefined;
    this.written.glyphs = [];
    this.written.caret = null;
    this.written.hidden = false;
    this.written.cancelledAt = undefined;
    this.scrimTarget = this.swirlTarget = 0;
    this.setVoice("off");
    this.shown?.();
    this.shown = undefined;
  }

  private move = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" && !this.pointer.down) return;
    if (this.pointer.x > -1e3) {
      const dx = event.clientX - this.pointer.x,
        dy = event.clientY - this.pointer.y;
      this.pointer.dx += dx;
      this.pointer.dy += dy;
      this.pointer.moved = true;
      this.ring.travel += Math.hypot(dx, dy);
    }
    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;
    if (event.pointerType === "mouse") {
      this.ring.seen = true;
      this.wake();
    }
  };
  private leave = (event: PointerEvent) => {
    if (event.relatedTarget) return;
    this.ring.seen = false;
    this.wake();
  };
  private typing = () => {
    this.ring.seen = false;
    this.wake();
  };
  private press = (event: PointerEvent) => {
    this.pointer.down = true;
    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;
  };
  private release = (event: PointerEvent) => {
    this.pointer.down = false;
    if (event.pointerType !== "mouse") this.pointer.x = this.pointer.y = -1e4;
  };
  private lost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.settle();
    this.shown?.();
    this.unavailable();
  };
  private wake = () => {
    if (!this.disposed && !document.hidden && !this.frame) {
      this.last = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    }
  };

  private tick = (now: number) => {
    this.frame = 0;
    if (this.disposed || this.gl.isContextLost()) return;
    const gl = this.gl;
    const reduced = this.reduced.matches;
    const dt = Math.min(Math.max((now - this.last) / 1000, 0), 1 / 30);
    this.last = now;

    if (this.transition) {
      const since = (now - this.transition.start) / 1000;
      const progress = Math.min(1, (since * 1000) / this.transition.duration);
      // A gentle curve: its steepest moment is only 1.5× the average, so no instant reads as a jump.
      this.field.mix = smooth(progress);
      // The new colors spread from where the words' paint landed; after a while they hurry to
      // reach whatever they have not, and just before settling the last of it is filled in.
      this.fluid.hold = smooth((since - 4.4) / 1.4);
      this.fluid.finish = since > 6.6 ? 6 : 0;
      const [sx, sy, n] = this.landed;
      this.fluid.arrival = {
        mode: this.arrival === "tide" ? 1 : 0,
        origin: n ? [sx / n / this.width, 1 - sy / n / this.height] : [0.15, 0.2],
        front: Math.max(0, since - 0.9) * 0.5,
      };
      if (progress >= 1) this.settle();
    }
    this.scrim = approach(this.scrim, this.scrimTarget, reduced ? 1e3 : 3, dt);
    this.scrimLightness = approach(this.scrimLightness, this.scrimTone, reduced ? 1e3 : 2, dt);
    const ring = this.ring;
    const voice = this.voice;
    ring.alpha = approach(
      ring.alpha,
      ring.seen && !ring.away && voice.phase === "off" ? 1 : 0,
      reduced ? 1e3 : 14,
      dt,
    );
    voice.presence = approach(
      voice.presence,
      voice.phase === "off" ? 0 : 1,
      reduced ? 1e3 : voice.phase === "off" ? 7 : 9,
      dt,
    );
    voice.heard = approach(voice.heard, voice.phase === "heard" ? 1 : 0, reduced ? 1e3 : 6, dt);
    // The voice is heard quickly and let go of slowly, so ripples run on through short pauses.
    voice.level *= Math.exp(-dt * 3.2);
    voice.swirl = approach(voice.swirl, voice.phase === "listening" ? voice.level : 0, 6, dt);
    voice.ripple += dt * (0.32 + voice.swirl * 0.9);
    voice.time += dt;
    ring.speed = approach(ring.speed, ring.travel / Math.max(dt, 1 / 240), 8, dt);
    ring.travel = 0;
    ring.press = approach(ring.press, this.pointer.down ? 1 : 0, reduced ? 1e3 : 16, dt);
    for (const { slot, rise, fall, blur } of Object.values(LABELS)) {
      const label = this.labels[slot];
      label.alpha = approach(
        label.alpha,
        label.target,
        reduced ? 1e3 : label.target > label.alpha ? rise : fall,
        dt,
      );
      // Out of focus while faint, sharpening as it arrives.
      label.blur = blur * (1 - Math.min(label.alpha / label.peak, 1));
    }
    this.swirl = approach(this.swirl, this.swirlTarget, 1.2, dt);
    // The light hangs over the pointer while there is one (a mouse in the window, a finger
    // down); otherwise it wanders slowly on its own. Nothing here needs a permission.
    const pointing = this.pointer.x > -1e3 && ((ring.seen && !ring.away) || this.pointer.down);
    const lit = reduced
      ? [0.22, 0.8]
      : pointing
        ? [this.pointer.x / this.width, 1 - this.pointer.y / this.height]
        : [0.5 + 0.34 * Math.cos(this.time * 0.13), 0.55 + 0.26 * Math.sin(this.time * 0.09 + 1)];
    this.light.x = approach(this.light.x, lit[0], reduced ? 1e3 : pointing ? 5 : 0.9, dt);
    this.light.y = approach(this.light.y, lit[1], reduced ? 1e3 : pointing ? 5 : 0.9, dt);
    // After an answer, a long window in which the fluid keeps the melted pigment
    // instead of snapping back to the field, so the flow can carry it on its own.
    const since = (now - this.burstAt) / 1000;
    const hold = smooth(since / 0.8) * (1 - smooth((since - 3.6) / 2.2));
    this.fade = approach(this.fade, 1, 1.4, dt);

    let sparks = 0;
    if (reduced) {
      this.fluid.seed(this.field);
    } else {
      this.time += dt;
      this.field.time += dt;
      this.blendStyles();
      // Thick liquids are only touched by pressing in; a passing mouse just moves the light.
      const tool = this.style.tool,
        probe = this.probe;
      const touching = this.pointer.x > -1e3 && (this.ring.seen || this.pointer.down);
      if (!touching) {
        probe.in = false;
      } else if (!probe.in) {
        Object.assign(probe, {
          x: this.pointer.x,
          y: this.pointer.y,
          vx: 0,
          vy: 0,
          in: true,
          still: 0,
        });
      } else {
        // The tool follows the hand on a critically damped spring, held back by the liquid.
        const x0 = probe.x,
          y0 = probe.y;
        if (tool.lag) {
          const w = 1 / tool.lag,
            e = Math.exp(-w * dt);
          const dx = probe.x - this.pointer.x,
            dy = probe.y - this.pointer.y;
          const bx = probe.vx + w * dx,
            by = probe.vy + w * dy;
          probe.x = this.pointer.x + (dx + bx * dt) * e;
          probe.y = this.pointer.y + (dy + by * dt) * e;
          probe.vx = (probe.vx - w * bx * dt) * e;
          probe.vy = (probe.vy - w * by * dt) * e;
        } else {
          probe.x = this.pointer.x;
          probe.y = this.pointer.y;
        }
        const step = Math.hypot(probe.x - x0, probe.y - y0),
          most = tool.speed * dt;
        if (step > most) {
          probe.x = x0 + ((probe.x - x0) * most) / step;
          probe.y = y0 + ((probe.y - y0) * most) / step;
          probe.vx = (probe.x - x0) / dt;
          probe.vy = (probe.y - y0) / dt;
        }
        probe.still = step > 0.05 ? 0 : probe.still + dt;
        // A fingertip in water leaves it soon after it stops, letting the eddies it shed coast on.
        if (probe.still < 0.2) this.touch(probe.x, probe.y, probe.x - x0, probe.y - y0, dt);
      }
      this.pointer.dx = this.pointer.dy = 0;
      this.pointer.moved = false;
      // A voice stirs the paint around the finger: a slow eddy that quickens as it grows louder.
      if (voice.presence > 0.01 && voice.swirl > 0.02) {
        for (let i = 0; i < 3; i++) {
          const angle = voice.time * 0.7 + (i * Math.PI * 2) / 3;
          const x = voice.x + Math.cos(angle) * 46,
            y = voice.y + Math.sin(angle) * 46;
          const speed = voice.swirl * 9 * voice.presence * (1 - voice.reach);
          this.touch(x, y, -Math.sin(angle) * speed, Math.cos(angle) * speed, dt);
        }
      }
      sparks = this.swarm.step(dt, this.flow);
      const flow = this.style.flow;
      this.land();
      this.spread(dt);
      this.fluid.step(
        dt,
        this.field,
        this.swirl * 28 * flow.swirl,
        (0.85 - 0.65 * hold) * flow.relax,
      );
      this.fluid.readFlow();
      this.fluid.paint(this.swarm.dye, this.swarm.painted, this.width, this.height, this.field);
    }
    const view = this.view();
    this.fluid.display(this.canvas.width, this.canvas.height, view);
    this.drawWriting(now / 1000, reduced, view);
    if (!reduced) {
      this.drawWords(view);
      this.draw(this.swarm.screen, sparks, this.swarm.adopt);
    }

    const settling =
      Math.abs(this.scrim - this.scrimTarget) > 0.001 ||
      Math.abs(this.scrimLightness - this.scrimTone) > 0.001 ||
      this.labels.some((label) => Math.abs(label.alpha - label.target) > 0.001) ||
      Math.abs(this.ring.alpha - (this.ring.seen && !this.ring.away ? 1 : 0)) > 0.001 ||
      Math.abs(this.voice.presence - (this.voice.phase === "off" ? 0 : 1)) > 0.001 ||
      this.ring.speed > 1;
    if (!reduced || this.transition || settling) this.frame = requestAnimationFrame(this.tick);
    if (gl.getError() === gl.CONTEXT_LOST_WEBGL) this.unavailable();
  };

  /**
   * The pointer or a voice drawn through the liquid to a css-px point, having moved (dx, dy)
   * css px over the last `dt` seconds. The liquid answers as its tool says: water is pushed and
   * swirls on, thick liquids move with the stroke and keep its groove a while.
   */
  private touch(x: number, y: number, dx: number, dy: number, dt: number) {
    this.fluid.touch(x - dx, y - dy, x, y, dt, this.width, this.height);
  }

  /** What the liquid makes of the particles that came down this frame (see Landing). */
  private land() {
    const { landings, landed } = this.swarm;
    if (this.transition)
      for (let i = 0; i < landed; i++) {
        this.landed[0] += landings[i * 5];
        this.landed[1] += landings[i * 5 + 1];
        this.landed[2]++;
      }
    const kind = this.landing,
      marks = this.marks;
    if (!landed) return;
    let n = 0;
    const put = (x: number, y: number, size: number, a: number, b: number) =>
      marks.set([x, y, size, 1, a, b, 0, 0, 0, 0], n++ * STRIDE);
    // Ink: about one drop in eight opens into a ring of small outward pushes, each of which the
    // pressure solve turns into a mushroom tip running outward. Milk: one in five opens wider,
    // its jets carrying milk out into lobes, a rosette, then a cloud. A film: one in seven opens a
    // ring in the film, with only a slight push to make it uneven.
    const milk = kind === "milk",
      film = kind === "film";
    const share = milk ? 0.2 : film ? 0.04 : 0.12,
      reach = milk ? 8 : 5,
      speed = milk ? 160 : 260;
    let thick = 0;
    for (let i = 0; i < landed && n < 240; i++) {
      if (film && Math.random() < 0.15 && this.rings.length < 40)
        this.rings.push({
          x: landings[i * 5],
          y: landings[i * 5 + 1],
          start: this.time,
          size: 24 + 28 * Math.random(),
        });
      if (Math.random() > share) continue;
      const tips = milk ? 5 + Math.floor(Math.random() * 3) : 3 + Math.floor(Math.random() * 4),
        phase = Math.random() * TAU;
      for (let k = 0; k < tips; k++) {
        const angle = phase + ((k + (Math.random() - 0.5) * 0.4) * TAU) / tips,
          c = Math.cos(angle),
          s = Math.sin(angle);
        const x = landings[i * 5] + c * reach,
          y = landings[i * 5 + 1] + s * reach;
        put(x, y, 12, c * speed, s * speed);
        if (milk && thick < 256)
          this.blobs.set([x, y, reach * 1.4, 0.65, 0, 0, 0, 0, 0, 0], thick++ * STRIDE);
      }
    }
    this.fluid.impulse(marks, n, this.width, this.height);
    this.fluid.thicken(this.blobs, thick, this.width, this.height);
  }

  /**
   * Opens the rings drops make in a film: each spreads fast and then ever more slowly (its radius
   * as t^(2/3)), thinning the film in its middle and heaping it up at its rim.
   */
  private spread(dt: number) {
    if (!this.rings.length) return;
    const span = 0.45,
      share = dt / span;
    let n = 0;
    for (const ring of this.rings) {
      const t = (this.time - ring.start) / span;
      if (t >= 1 || n > 500) continue;
      const radius = ring.size * Math.max(t, 0.05) ** (2 / 3);
      this.blobs.set([ring.x, ring.y, radius * 1.6, -0.17 * share, 0, 0, 0, 0, 0, 0], n++ * STRIDE);
      for (let k = 0; k < 10; k++) {
        const angle = (k * TAU) / 10;
        this.blobs.set(
          [
            ring.x + Math.cos(angle) * radius,
            ring.y + Math.sin(angle) * radius,
            radius * 0.7,
            0.07 * share,
            0,
            0,
            0,
            0,
            0,
            0,
          ],
          n++ * STRIDE,
        );
      }
    }
    this.rings = this.rings.filter((ring) => this.time - ring.start < span);
    this.fluid.thicken(this.blobs, n, this.width, this.height);
  }

  /** What landing particles become: in the arriving liquid, once one is on its way. */
  private get landing() {
    return MATERIALS[this.shift?.to ?? this.material].landing;
  }

  private view(): View {
    return {
      aspect: this.field.aspect,
      time: this.time,
      scrim: this.scrim,
      scrimLightness: this.scrimLightness,
      fade: this.fade,
      view: [this.width, this.height],
      labels: this.labels,
      // It swells a little with speed, like a brush loading, and tightens on press.
      ring: [
        this.pointer.x,
        this.pointer.y,
        6 + 4 * Math.min(this.ring.speed / 1400, 1) - 2 * this.ring.press,
        this.ring.alpha,
      ],
      voice: [
        this.voice.x,
        this.voice.y,
        this.voice.presence,
        this.voice.reach,
        this.voice.swirl,
        this.voice.ripple % 1,
        this.voice.heard,
        this.voice.time,
      ],
      light: [this.light.x, this.light.y, 0.42],
    };
  }

  private drawWriting(now: number, still: boolean, view: View) {
    const state = this.written;
    const showing = !!state.caret && !this.wordsRect && !state.hidden;
    // The caret breathes: steady while keys are pressed, then slowly fading in and out.
    const since = now - state.changed;
    const breath =
      still || since < 0.6 ? 1 : 0.5 + 0.5 * Math.cos(((since - 0.6) * Math.PI) / 0.75);
    state.presence = showing ? breath : 0;
    if (state.hidden || this.wordsRect || (!state.glyphs.length && !showing)) return;
    const opacity =
      state.cancelledAt === undefined
        ? 1
        : Math.min(1, Math.max(0, 1 - ((now - state.cancelledAt) * 1000) / cancelDuration));
    if (!opacity) return;
    const [tw, th] = state.size;
    const data = new Float32Array((state.glyphs.length + 1) * 11);
    const [a, b] = state.caret?.selection ?? [0, 0];
    let count = 0;
    for (const glyph of state.glyphs) {
      const [sx, sy, sw, sh] = glyph.source;
      const selected = count >= a && count < b ? 1 : 0;
      data.set(
        [
          ...(still ? glyph.to : this.place(glyph, now)),
          sx / tw,
          sy / th,
          sw / tw,
          sh / th,
          state.cancelledAt === undefined
            ? still
              ? 1
              : (now - glyph.born) / ARRIVE
            : Math.min((now - glyph.born) / ARRIVE, opacity),
          selected,
          opacity,
        ],
        count++ * 11,
      );
    }
    if (showing && a === b)
      data.set(
        [...(still ? state.caretBox : this.caretAt(now)), 0, 0, 0, 0, state.presence, 0, 1],
        count++ * 11,
      );
    const gl = this.gl,
      u = this.writing.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.writing.handle);
    this.fluid.surface(u, 0, view);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, state.texture);
    gl.uniform1i(u.uWords, 1);
    gl.uniform2f(u.uView, this.width, this.height);
    gl.uniform1f(u.uContrast, WRITING_CONTRAST);
    gl.bindVertexArray(this.writingVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.writingBuffers[1]);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 11), gl.STREAM_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  private drawWords(view: View) {
    if (!this.wordsRect) return;
    const mode = this.swarm.mode;
    if (mode === "idle" || mode === "steep") {
      this.wordsRect = undefined;
      return;
    }
    const front = this.swarm.front();
    // Fully eroded: nothing left to draw.
    if (front > 1.1) return;
    const gl = this.gl,
      u = this.words.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.words.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.glyphs);
    gl.uniform1i(u.uGlyphs, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.order);
    gl.uniform1i(u.uOrder, 1);
    gl.uniform4f(u.uRect, ...this.wordsRect);
    gl.uniform2f(u.uSize, this.width, this.height);
    gl.uniform1f(u.uFront, front);
    gl.uniform3f(u.uRim, ...this.style.rim);
    gl.uniform1f(u.uContrast, WRITING_CONTRAST);
    gl.uniform2f(u.uView, this.canvas.width, this.canvas.height);
    this.fluid.surface(u, 2, view);
    gl.bindVertexArray(this.wordsVao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    if (this.shown) {
      const shown = this.shown;
      this.shown = undefined;
      requestAnimationFrame(() => shown());
    }
  }

  /** `adopt` is how much of the surrounding color's hue the particles take on. */
  private draw(data: Float32Array, count: number, adopt = 0) {
    if (!count) return;
    const gl = this.gl,
      u = this.points.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.points.handle);
    gl.uniform2f(u.uSize, this.width, this.height);
    gl.uniform1f(u.uScale, this.ratio);
    gl.uniform2f(u.uView, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uAdopt, adopt);
    gl.uniform1f(u.uContrast, WRITING_CONTRAST);
    // The particles' form as the words came apart, giving way to the arriving liquid's.
    const shift = this.shift;
    gl.uniform1f(u.uShape, MATERIALS[shift?.from ?? this.material].particle.shape);
    gl.uniform1f(u.uShapeTo, MATERIALS[shift?.to ?? this.material].particle.shape);
    gl.uniform1f(u.uShapeMix, shift ? smooth((this.time - shift.start) / 0.9) : 0);
    gl.uniform3f(u.uTone, ...this.swarm.style.tone);
    this.fluid.field(u, this.field);
    gl.uniform3f(u.uLight, this.light.x, this.light.y, 0.42);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fluid.pigment);
    gl.uniform1i(u.uDye, 0);
    gl.bindVertexArray(this.pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * STRIDE), gl.STREAM_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.disable(gl.BLEND);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.settle();
    this.canvas.removeEventListener("webglcontextlost", this.lost);
    document.removeEventListener("visibilitychange", this.wake);
    window.removeEventListener("pointermove", this.move);
    window.removeEventListener("pointerdown", this.press);
    window.removeEventListener("pointerup", this.release);
    window.removeEventListener("pointerout", this.leave);
    window.removeEventListener("keydown", this.typing);
    this.reduced.removeEventListener("change", this.wake);
    this.fluid.dispose();
    this.gl.deleteProgram(this.points.handle);
    this.gl.deleteBuffer(this.pointBuffer);
    this.gl.deleteVertexArray(this.pointVao);
    this.gl.deleteProgram(this.words.handle);
    this.gl.deleteBuffer(this.wordsBuffer);
    this.gl.deleteVertexArray(this.wordsVao);
    this.gl.deleteProgram(this.writing.handle);
    this.gl.deleteVertexArray(this.writingVao);
    for (const buffer of this.writingBuffers) this.gl.deleteBuffer(buffer);
    this.gl.deleteTexture(this.written.texture);
    this.gl.deleteTexture(this.glyphs);
    this.gl.deleteTexture(this.order);
    for (const label of this.labels) this.gl.deleteTexture(label.texture);
    this.shown?.();
  }
}
