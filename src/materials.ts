import type { Lab } from "./color";

/** The liquids the painting can be shown in. Each example names one; silk is the default. */
export type Material = "silk" | "film" | "milk";

/** How the words' particles look and move. Sizes are css px. */
export type ParticleStyle = {
  /** The point shader's shape: 0 a soft dot, 1 a spinning shard, 2 a glossy bead. */
  shape: 0 | 1 | 2;
  /** Smallest size, and how much larger the biggest ones grow. */
  size: [number, number];
  /** How far a particle rises once it leaves the letter, in css px. */
  lift: number;
  /** How far it then sinks as it drifts, as a share of the screen height. */
  sink: number;
  /** How fast shards tumble, in radians per second. */
  spin: number;
  /** The flash at the moment of release, matching the erosion rim (sRGB). */
  glint: Lab;
  /** How much of the light ink's additive glow it keeps. */
  glow: number;
  /** How widely it spreads its color as it is taken into the paint; 1 is a small drop. */
  pour: number;
  /** How much of the faint, wide trail of pigment it leaves as it drifts on, after landing. */
  bleed: number;
  /** The value it gives the liquid's carried scalar where it lands (see Flow.rest). */
  mark: number;
  /**
   * How it shows the color it takes on, in OKLab: lightness times the first, plus the second;
   * chroma times the third. Milk's drops are the pale shade they become.
   */
  tone: [number, number, number];
};

/** How the fluid itself behaves: the same simulation, tuned to a different liquid. */
export type Flow = {
  /** The slow ambient drift that keeps the paint alive. */
  ambient: number;
  /** Vorticity confinement: how readily the flow curls into eddies. */
  curl: number;
  /** How quickly motion dies away, per second. */
  drag: number;
  /** How readily the paint settles back toward the resting field, relative to silk. */
  relax: number;
  /** How hard the words' swirl turns, relative to silk. */
  swirl: number;
  /** Carries the paint with a correction that keeps its filaments and edges sharp. */
  sharp: boolean;
  /**
   * An amount carried with the paint in its fourth channel, 0 to about 1, which each liquid reads
   * in its own way (a film's thickness, milk's density), so it carries over when one liquid gives
   * way to another; it drifts back to `rest` at `settle` per second wherever nothing disturbs it.
   */
  rest: number;
  settle: number;
  /** How far the resting value varies across the page, in slowly drifting clouds. */
  vary: number;
  /** How readily the scalar thins where the flow stretches the paint (a film's thickness). */
  stretch: number;
};

/** What touches the liquid: a fingertip. */
export type Tool = {
  /** Its radius in css px, and the soft edge around it. */
  radius: number;
  edge: number;
  /** How far behind the hand it trails, in seconds (a critically damped spring). */
  lag: number;
  /** The fastest it moves, in css px per second. */
  speed: number;
  /**
   * How fast the liquid it touches takes on its velocity, per second: the liquid is dragged by
   * the difference between the two rather than set in motion all at once.
   */
  couple: number;
  /**
   * How much it thins the carried scalar along its stroke, per stroke radius drawn; as much is
   * heaped up beside it (a film pushed aside, thin in its wake and thick along its edges).
   */
  thin: number;
};

/**
 * What a particle does as it comes down: some ink drops open into rings of mushroom tips; milk
 * drops open into a bright ring that grows lobes, then a rosette, then a cloud; a drop on a film
 * opens a ring, thin in the middle and thick at its rim, spreading fast and then slowing.
 */
export type Landing = "ink" | "milk" | "film";

/** A liquid: how it moves, how it is lit, and how the words come apart into it. */
export type MaterialStyle = {
  /** Its number in the shaders' look(). */
  id: number;
  flow: Flow;
  tool: Tool;
  landing: Landing;
  /** The words erode in shards of about this many css px; 0 erodes them grain by grain. */
  shards: number;
  /** The erosion front's rim (sRGB). */
  rim: Lab;
  particle: ParticleStyle;
};

const PEARL: Lab = [1, 0.9, 0.74];

export const MATERIALS: Record<Material, MaterialStyle> = {
  // Ink in water: a fingertip is a small body the water slips past, shedding a pair of eddies
  // that coast on after it stops; swirls last; filaments stay sharp; drops open into rings.
  silk: {
    id: 0,
    flow: {
      ambient: 12,
      curl: 8,
      drag: 0.14,
      relax: 1,
      swirl: 0.6,
      sharp: true,
      rest: 0,
      settle: 0,
      vary: 0,
      stretch: 0,
    },
    tool: { radius: 18, edge: 6, lag: 0.03, speed: 2500, couple: 30, thin: 0 },
    landing: "ink",
    shards: 0,
    rim: PEARL,
    particle: {
      shape: 0,
      size: [0.8, 1.8],
      lift: 30,
      sink: 0,
      spin: 0,
      glint: PEARL,
      glow: 1,
      pour: 1,
      bleed: 0.5,
      mark: 0,
      tone: [1, 0, 1],
    },
  },
  // An oil slick or soap film over water: it flows as water does; what it shows is its thickness.
  film: {
    id: 1,
    flow: {
      ambient: 12,
      curl: 8,
      drag: 0.14,
      relax: 1,
      swirl: 0.6,
      sharp: true,
      rest: 0.24,
      settle: 0.1,
      vary: 0.5,
      stretch: 0.12,
    },
    tool: { radius: 18, edge: 6, lag: 0.03, speed: 2500, couple: 30, thin: 0.36 },
    landing: "film",
    shards: 0,
    rim: PEARL,
    particle: {
      shape: 2,
      size: [0.8, 1.8],
      lift: 30,
      sink: 0,
      spin: 0,
      glint: PEARL,
      glow: 1,
      pour: 1,
      bleed: 0.3,
      mark: 0.06,
      tone: [1, 0, 1],
    },
  },
  // Milk poured into tea: it flows as water does; what it shows is how dense the milk is.
  milk: {
    id: 2,
    flow: {
      ambient: 12,
      curl: 8,
      drag: 0.14,
      relax: 1,
      swirl: 0.6,
      sharp: true,
      rest: 0.03,
      settle: 0.02,
      vary: 0.5,
      stretch: 0,
    },
    tool: { radius: 18, edge: 6, lag: 0.03, speed: 2500, couple: 30, thin: 0 },
    landing: "milk",
    shards: 0,
    rim: PEARL,
    particle: {
      shape: 0,
      size: [0.8, 1.8],
      lift: 30,
      sink: 0,
      spin: 0,
      glint: PEARL,
      glow: 1,
      pour: 1,
      bleed: 0.2,
      mark: 0.85,
      tone: [0.3, 0.62, 0.85],
    },
  },
};

export function parseMaterial(value: string | null | undefined): Material {
  return value && value in MATERIALS ? (value as Material) : "silk";
}

/**
 * Settings partway from one material to another, `k` of the way: numbers in between, so the
 * liquid changes gradually as a new material arrives; choices from the nearer one.
 */
export function between<T>(a: T, b: T, k: number): T {
  if (typeof a === "number" && typeof b === "number") return (a + (b - a) * k) as T;
  if (Array.isArray(a) && Array.isArray(b))
    return a.map((value, i) => between(value, b[i], k)) as T;
  if (a && b && typeof a === "object")
    return Object.fromEntries(
      Object.keys(a).map((key) => [
        key,
        between((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], k),
      ]),
    ) as T;
  return k < 0.5 ? a : b;
}
