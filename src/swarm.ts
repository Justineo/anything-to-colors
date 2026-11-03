import { STRIDE, type Flow, type PaintPalette } from "./fluid";
import type { Lab } from "./color";
import { MATERIALS, type ParticleStyle } from "./materials";

const TAU = Math.PI * 2;
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** Per-frame opacity that paints the same amount per second at any refresh rate. */
const perFrame = (alpha: number, dt: number) => 1 - (1 - alpha) ** (dt * 60);

/** Seconds the reading-order erosion takes to cross the words. */
const ERODE = 1.3;
/** Erosion front over time; a pixel with threshold e is gone once the front passes e. */
export const erosion = (clock: number) => (clock / ERODE) * 1.1 - 0.05;
/** How long one particle takes to melt into the paint once it starts, and how much of that it stays visible. */
const MELT = 1.8;
const HANDOFF = 0.45;

type Mode = "idle" | "gather" | "steep";

/**
 * The words themselves, sampled from their real glyph pixels. Each particle is
 * released exactly when the erosion front reaches its pixel, lifts like ash and
 * then drifts away from where it was, scattering at random on slow currents while
 * the color is being mixed. When the answer arrives each particle first takes on
 * its color in place, then softens into the fluid as a spot of dye.
 */
export class Swarm {
  count = 0;
  mode: Mode = "idle";
  clock = 0;
  screen: Float32Array;
  dye: Float32Array;
  painted = 0;
  /** Where particles came down this frame: x, y in css px and their OKLab color, for each. */
  landings: Float32Array;
  landed = 0;
  glow = 1;
  /** What the particles are made of: ash, shards, beads. */
  style: ParticleStyle = MATERIALS.silk.particle;
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private hx: Float32Array;
  private hy: Float32Array;
  private edge: Float32Array;
  private s1: Float32Array;
  private s2: Float32Array;
  private s3: Float32Array;
  private ox: Float32Array;
  private oy: Float32Array;
  private drop: Float32Array;
  private lab: Float32Array;
  private freed: Uint8Array;
  /** Each particle's own color, taken from its pixel: the ink, or an emoji's colors. */
  private base: Float32Array;
  /** How far the color's currents have carried each particle from where it would drift alone. */
  private fx: Float32Array;
  private fy: Float32Array;
  private current: [number, number] = [0, 0];
  private flow: Flow = (_x, _y, out) => ((out[0] = out[1] = 0), out);
  private grain = 2;
  private width = 1;
  private height = 1;
  private settled = 0;
  private finish = 0;
  private tint: Lab = [1, 1, 1];
  private pigment: Lab = [1, 1, 1];

  constructor(readonly capacity: number) {
    const floats = () => new Float32Array(capacity);
    [
      this.x,
      this.y,
      this.vx,
      this.vy,
      this.hx,
      this.hy,
      this.edge,
      this.s1,
      this.s2,
      this.s3,
      this.ox,
      this.oy,
      this.drop,
    ] = Array.from({ length: 13 }, floats);
    this.lab = new Float32Array(capacity * 3);
    this.freed = new Uint8Array(capacity);
    this.base = new Float32Array(capacity * 3);
    this.fx = new Float32Array(capacity);
    this.fy = new Float32Array(capacity);
    this.screen = new Float32Array(capacity * STRIDE);
    // Up to two splats per particle a frame: the handoff and the bleed.
    this.dye = new Float32Array(capacity * 2 * STRIDE);
    this.landings = new Float32Array(capacity * 5);
  }

  /** `points` holds x, y, erosion threshold and r, g, b for each particle. */
  form(points: Float32Array, count: number, grain: number, width: number, height: number) {
    this.count = Math.min(count, this.capacity);
    this.grain = grain;
    this.width = width;
    this.height = height;
    for (let i = 0; i < this.count; i++) {
      this.x[i] = this.hx[i] = points[i * 6];
      this.y[i] = this.hy[i] = points[i * 6 + 1];
      this.edge[i] = points[i * 6 + 2];
      this.base.set(points.subarray(i * 6 + 3, i * 6 + 6), i * 3);
      this.vx[i] = this.vy[i] = 0;
      this.fx[i] = this.fy[i] = 0;
      this.freed[i] = 0;
      this.s1[i] = Math.random();
      this.s2[i] = Math.random();
      this.s3[i] = Math.random();
      // Each particle wanders off in its own random direction from where it was released,
      // a Gaussian scatter, so nothing is pulled toward a shared centre.
      const r = Math.sqrt(-2 * Math.log(1 - 0.995 * Math.random())),
        a = Math.random() * TAU;
      this.ox[i] = Math.cos(a) * r * width * 0.26;
      this.oy[i] = Math.sin(a) * r * height * 0.24;
    }
    this.mode = "gather";
    this.clock = 0;
  }

  /** Ink takes on the surrounding hue; once the answer arrives the particles show their own colors. */
  get adopt() {
    return this.mode === "steep" ? 0.55 * (1 - smooth(this.clock / 0.8)) : 0.55;
  }

  /** Where the text erosion front stands; above 1 the words are fully gone. */
  front() {
    if (this.mode === "gather") return erosion(this.clock);
    return 2;
  }

  /**
   * The answer has arrived. Each particle takes the color the resting field will show
   * where it floats (same palette curve as the shader, along the same axis), so its dye
   * already matches the background it is about to become.
   */
  steep({ labs, edges }: PaintPalette) {
    if (this.mode === "idle") return;
    this.settled = this.clock;
    const aspect = this.width / this.height;
    const extent = 0.5 * (aspect * 0.894 + 0.447);
    this.finish = 0;
    for (let i = 0; i < this.count; i++) {
      const along =
        ((this.x[i] - this.width / 2) * 0.894 - (this.y[i] - this.height / 2) * 0.447) /
        this.height;
      const position = Math.min(
        1,
        Math.max(0, along / (2 * extent) + 0.5 + (this.s3[i] - 0.5) * 0.08),
      );
      let index = 0;
      while (index < 8 && position >= edges[index * 2 + 1]) index++;
      const start = edges[index * 2];
      const end = edges[index * 2 + 1];
      const blend = position > start ? smooth((position - start) / (end - start)) : 0;
      const offset = index * 3;
      const lab: Lab = [labs[offset], labs[offset + 1], labs[offset + 2]];
      if (blend) for (let c = 0; c < 3; c++) lab[c] = mix(lab[c], labs[offset + 3 + c], blend);
      this.lab.set(lab, i * 3);
      // Melting starts once the particle has its color, spread over a second: enough that the
      // color sinks in gradually, short enough that few dots linger over paint already laid.
      this.drop[i] = 0.8 + 1.0 * ((this.s1[i] * 7.31) % 1);
      this.finish = Math.max(this.finish, this.drop[i] + MELT);
    }
    this.mode = "steep";
    this.clock = 0;
  }

  /** Returns how many particles were written to `screen`; dye splats land in `painted`. */
  step(dt: number, flow: Flow) {
    this.flow = flow;
    this.painted = this.landed = 0;
    if (this.mode === "idle") return 0;
    this.clock += dt;
    if (this.mode === "gather") return this.gather(dt);
    return this.steepen(dt);
  }

  /** Where particle i wants to be, `age` seconds after release, and how it looks there. */
  private drift(i: number, t: number, age: number) {
    const { hx, hy, s1, s2 } = this;
    const style = this.style;
    // First the ash lifts and wavers where it was released...
    const lift = 1 - Math.exp(-age * 2.4),
      waver = smooth(age / 0.6);
    const curl = s1[i] * TAU * 3 + age * (0.6 + s2[i]);
    const ax = hx[i] + Math.sin(curl) * 18 * waver;
    const ay =
      hy[i] -
      style.lift * (1 + 1.33 * s2[i]) * lift +
      Math.cos(curl * 1.3) * 9 * waver +
      // Heavier particles (shards, beads) settle slowly downward as they drift.
      style.sink *
        this.height *
        (1 - Math.exp(-Math.max(0, age - 0.4) * 0.3)) *
        (0.6 + 0.8 * s1[i]);
    // ...then it keeps scattering outward, quickly at first and ever more slowly,
    // carried by slow currents that move neighbours together.
    const reach = 1 - Math.exp(-Math.max(0, age - 0.2) * 0.5);
    // No walls: particles may drift past the edges, so long texts never pile up into a frame.
    let px = ax + this.ox[i] * reach,
      py = ay + this.oy[i] * reach;
    const H = this.height,
      u = px / H,
      v = py / H,
      current = H * 0.05 * smooth(age / 2);
    px += (Math.sin(v * 3.1 + t * 0.3) + 0.6 * Math.sin((u + v) * 2.3 - t * 0.2 + 1.3)) * current;
    py += (Math.cos(u * 2.7 - t * 0.25) + 0.6 * Math.cos((u - v) * 2.9 + t * 0.17 + 2.1)) * current;
    const grit = (s1[i] * 13.37 + s2[i] * 7.11) % 1;
    const twinkle = 0.75 + 0.25 * Math.sin(t * (2 + s2[i] * 3) + s1[i] * 50);
    const size = style.size[0] + style.size[1] * grit * grit;
    // Shards tumble, each at its own pace and direction; it costs nothing for the others.
    const spin = s1[i] * TAU + age * style.spin * (s2[i] - 0.5) * 2;
    return { x: px, y: py, size, alpha: 0.65 * twinkle, spin };
  }

  /** `carry` hands the particle's motion over to the fluid: at 1 it moves exactly with the paint. */
  private follow(i: number, x: number, y: number, dt: number, carry = 0) {
    // The fluid carries the particle off its path the way it carries the paint; the offset
    // then eases back, as the color itself relaxes, so a stir reads as one gesture in both.
    const current = this.flow(this.x[i], this.y[i], this.current);
    const relax = Math.exp(-dt * 0.45);
    this.fx[i] = this.fx[i] * relax + current[0] * dt;
    this.fy[i] = this.fy[i] * relax + current[1] * dt;
    x += this.fx[i];
    y += this.fy[i];
    this.vx[i] += ((x - this.x[i]) * 38 - this.vx[i] * 11.5) * dt;
    this.vy[i] += ((y - this.y[i]) * 38 - this.vy[i] * 11.5) * dt;
    if (carry > 0) {
      this.vx[i] = mix(this.vx[i], current[0], carry);
      this.vy[i] = mix(this.vy[i], current[1], carry);
    }
    this.x[i] += this.vx[i] * dt;
    this.y[i] += this.vy[i] * dt;
  }

  private gather(dt: number) {
    const t = this.clock,
      front = erosion(t);
    const { vx, vy, s1, s2 } = this;
    let drawn = 0;
    for (let i = 0; i < this.count; i++) {
      // Still part of the solid words: the text layer draws this pixel.
      if (front < this.edge[i]) continue;
      if (!this.freed[i]) {
        // Released with a small upward puff so it leaves the letter shape at once.
        this.freed[i] = 1;
        vx[i] = (s1[i] - 0.5) * 90;
        vy[i] = -(60 + 120 * s2[i]);
      }
      const age = ((front - this.edge[i]) / 1.1) * ERODE;
      const spot = this.drift(i, t, age);
      this.follow(i, spot.x, spot.y, dt);
      // A brief glint at the moment of release, matching the erosion rim.
      const glint = 1 - smooth(age / 0.35);
      const settle = smooth(age / 1.2);
      const tint = this.tint,
        flash = this.style.glint;
      const b = i * 3;
      tint[0] = mix(this.base[b], flash[0], glint * 0.7);
      tint[1] = mix(this.base[b + 1], flash[1], glint * 0.7);
      tint[2] = mix(this.base[b + 2], flash[2], glint * 0.7);
      const size = mix(this.grain, spot.size, settle) * (1 + glint * 0.4);
      drawn = this.put(
        this.screen,
        drawn,
        this.x[i],
        this.y[i],
        size,
        mix(0.95, spot.alpha, settle),
        tint,
        mix(this.glow * this.style.glow, 0.6, glint),
        spot.spin,
      );
    }
    return drawn;
  }

  private steepen(dt: number) {
    const t = this.clock;
    const { s2, s3 } = this;
    const front = erosion(this.settled);
    let drawn = 0;
    for (let i = 0; i < this.count; i++) {
      const since = t - this.drop[i];
      if (since >= MELT) continue;
      // Until it melts, keep floating exactly as before: the answer changes the color, not the motion.
      const age = (Math.max(0, front - this.edge[i]) / 1.1) * ERODE + t;
      const spot = this.drift(i, this.settled + t, age);
      // Once it starts to melt it stops drifting on its own and moves only with the paint,
      // so the pigment it gives up stays under it instead of trailing behind.
      this.follow(i, spot.x, spot.y, dt, since > 0 ? smooth(since / 0.25) : 0);
      const o = i * 3;
      // First every particle takes on its color where it floats, a few at a time...
      // (the point shader blends it toward the color its spot will rest at in the new palette).
      const recolor = smooth((t - 0.05 - 0.35 * s3[i]) / 0.7);
      const tint = this.tint;
      tint[0] = this.base[o];
      tint[1] = this.base[o + 1];
      tint[2] = this.base[o + 2];
      // ...then it is handed over to the paint. For a moment it pours its color, densely and
      // at its own size, into the paint right beneath it while it fades, so a dot of paint takes
      // its place with no visible switch. After that it is no longer drawn: it drifts on with the
      // current as an unseen carrier, releasing a little pigment that the flow pulls into the
      // same streaks and folds as the rest of the color.
      // Ash settles into a round drop; shards and beads keep their own shape and size.
      const style = this.style;
      const dot = style.shape ? spot.size : mix(spot.size, 2.4 + 1.8 * s2[i], recolor);
      const absorb = smooth(since / HANDOFF);
      if (absorb < 1)
        drawn = this.put(
          this.screen,
          drawn,
          this.x[i],
          this.y[i],
          dot,
          mix(spot.alpha, 0.9, recolor) * (1 - absorb),
          tint,
          mix(this.glow * this.style.glow, 0, recolor),
          spot.spin,
          recolor,
        );
      // The moment it lands, for liquids that answer a landing (ink drops opening into rings).
      if (since >= 0 && since - dt < 0 && this.landed < this.capacity) {
        this.landings.set(
          [this.x[i], this.y[i], this.lab[o], this.lab[o + 1], this.lab[o + 2]],
          this.landed++ * 5,
        );
      }
      if (since > 0) {
        const pigment = this.pigment;
        pigment[0] = this.lab[o];
        pigment[1] = this.lab[o + 1];
        pigment[2] = this.lab[o + 2];
        if (since < HANDOFF * 1.3) {
          this.painted = this.put(
            this.dye,
            this.painted,
            this.x[i],
            this.y[i],
            dot * 2.2 * style.pour,
            perFrame(0.22 / style.pour, dt),
            pigment,
            0,
          );
        }
        const bleed = (since - HANDOFF * 0.5) / (MELT - HANDOFF * 0.5);
        if (bleed > 0 && style.bleed) {
          this.painted = this.put(
            this.dye,
            this.painted,
            this.x[i],
            this.y[i],
            14 + 18 * s3[i],
            perFrame(0.05 * style.bleed * Math.sin(Math.PI * bleed), dt),
            pigment,
            0,
          );
        }
      }
    }
    if (t >= this.finish) this.mode = "idle";
    return drawn;
  }

  private put(
    out: Float32Array,
    index: number,
    x: number,
    y: number,
    size: number,
    alpha: number,
    color: Lab,
    glow: number,
    spin = 0,
    recolor = 0,
  ) {
    const o = index * STRIDE;
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = size;
    out[o + 3] = alpha;
    out[o + 4] = color[0];
    out[o + 5] = color[1];
    out[o + 6] = color[2];
    out[o + 7] = glow;
    out[o + 8] = spin;
    out[o + 9] = recolor;
    return index + 1;
  }
}
