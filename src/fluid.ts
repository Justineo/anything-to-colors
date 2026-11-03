import {
  createDouble,
  createProgram,
  createTarget,
  deleteTarget,
  type Double,
  type Program,
  type Target,
} from "./gl";
import {
  advectFragment,
  blendFragment,
  markFragment,
  curlFragment,
  displayFragment,
  divergenceFragment,
  dyeFragment,
  fadeFragment,
  forcesFragment,
  gradientFragment,
  paintFragment,
  pointVertex,
  pressureFragment,
  quadVertex,
  toolFragment,
  vorticityFragment,
} from "./shaders";
import type { MaterialStyle } from "./materials";

export type PaintPalette = { labs: Float32Array; edges: Float32Array };

export type FieldState = {
  paletteA: PaintPalette;
  paletteB: PaintPalette;
  mix: number;
  time: number;
  aspect: number;
  /** Whether the new palette is spreading out from where the words' paint landed. */
  spread: boolean;
};

/** Words drawn into the painting by the display shader, laid out by the DOM. */
export type Label = {
  texture: WebGLTexture;
  /** Where the texture lies on the page, in css px; empty when there is nothing to draw. */
  rect: [number, number, number, number];
  alpha: number;
  /** How far out of focus it is, in css px. */
  blur: number;
  /** The APCA lightness contrast its strokes keep with the paint under them. */
  contrast: number;
};

export const STRIDE = 10;

/** Samples the fluid's velocity at a css-pixel position, in css px/s with y down. */
export type Flow = (x: number, y: number, out: [number, number]) => [number, number];

export class Fluid {
  sim = { width: 1, height: 1 };
  /** The page's width in css px, for speeds given in css px per second. */
  page = 1;
  private velocity?: Double;
  private dye?: Double;
  /** How far an arriving material has reached, carried with the paint. */
  private blend?: Double;
  /** The paint carried one plain step ahead, which the sharp correction traces back. */
  private ahead?: Target;
  private pressure?: Double;
  private divergence?: Target;
  private curl?: Target;
  private quad: WebGLVertexArrayObject;
  private quadBuffer: WebGLBuffer;
  private paintVao: WebGLVertexArrayObject;
  private paintBuffer: WebGLBuffer;
  private programs: Record<string, Program>;
  // A CPU copy of the velocity field, read back asynchronously one frame late,
  // so particles can be carried by the very same currents as the color.
  private pbo?: WebGLBuffer;
  private fence: WebGLSync | null = null;
  private flowData = new Float32Array(0);
  private flowReady = false;
  private flowChecked = false;
  private flowOk = true;

  /**
   * The material being left and the one arriving (their numbers in the shaders' look()), equal
   * when no change is under way; while they differ the arrival is carried with the paint.
   */
  materials: [number, number] = [0, 0];
  /**
   * Late in a palette change the new colors hurry to reach what they have not yet (`hold`), and
   * just before it settles fill in the last of it (`finish`, per second).
   */
  hold = 0;
  finish = 0;
  /** The resting field as last drawn, for surfaces that take colors from the palette. */
  private state?: FieldState;
  /**
   * The liquid showing and the one arriving, while a change is under way: the liquid moves
   * like each only where each is (see uBlend), so a thick liquid thickens only where it has
   * come in and the rest flows on as before.
   */
  pair?: [MaterialStyle, MaterialStyle];
  /**
   * How the new palette (and liquid) comes in (see blendFragment): spreading out from where the
   * words' paint landed, or flooding out from `origin` (uv) as a tide `front` screen heights out.
   */
  arrival = { mode: 0, origin: [0.15, 0.2] as [number, number], front: 0 };
  /** Whether a new palette is spreading (see blendFragment); begun and ended by the engine. */
  private spreading = false;

  /** `style` tunes the simulation to one kind of liquid; it may change from frame to frame. */
  constructor(
    private gl: WebGL2RenderingContext,
    public style: MaterialStyle,
  ) {
    if (
      !gl.getExtension("EXT_color_buffer_float") &&
      !gl.getExtension("EXT_color_buffer_half_float")
    )
      throw new Error("Float render targets unavailable");
    const quad = (fragment: string) => createProgram(gl, quadVertex, fragment);
    this.programs = {
      tool: quad(toolFragment),
      forces: quad(forcesFragment),
      curl: quad(curlFragment),
      vorticity: quad(vorticityFragment),
      divergence: quad(divergenceFragment),
      fade: quad(fadeFragment),
      pressure: quad(pressureFragment),
      gradient: quad(gradientFragment),
      advect: quad(advectFragment),
      dye: quad(dyeFragment),
      display: quad(displayFragment),
      blend: quad(blendFragment),
      mark: quad(markFragment),
      paint: createProgram(gl, pointVertex, paintFragment),
    };
    this.quad = gl.createVertexArray()!;
    this.quadBuffer = gl.createBuffer()!;
    gl.bindVertexArray(this.quad);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    [this.paintVao, this.paintBuffer] = pointArray(gl);
    gl.bindVertexArray(null);
  }

  resize(aspect: number, dyeLong: number, field: FieldState) {
    const gl = this.gl;
    this.release();
    const fit = (long: number) =>
      aspect >= 1
        ? { width: long, height: Math.max(1, Math.round(long / aspect)) }
        : { width: Math.max(1, Math.round(long * aspect)), height: long };
    const simShort = 128;
    this.sim = fit(Math.round(simShort * Math.max(aspect, 1 / aspect)));
    const dye = fit(Math.round(dyeLong));
    const { LINEAR, NEAREST, RG16F, RG, R16F, RED, RGBA16F, RGBA } = gl;
    this.velocity = createDouble(gl, this.sim.width, this.sim.height, RG16F, RG, LINEAR);
    this.pressure = createDouble(gl, this.sim.width, this.sim.height, R16F, RED, NEAREST);
    this.divergence = createTarget(gl, this.sim.width, this.sim.height, R16F, RED, NEAREST);
    this.curl = createTarget(gl, this.sim.width, this.sim.height, R16F, RED, NEAREST);
    this.dye = createDouble(gl, dye.width, dye.height, RGBA16F, RGBA, LINEAR);
    // Every liquid's buffers, whichever is showing: another may arrive with the next palette.
    this.ahead = createTarget(gl, dye.width, dye.height, RGBA16F, RGBA, LINEAR);
    this.blend = createDouble(gl, dye.width, dye.height, R16F, RED, LINEAR);
    this.seed(field);
  }

  /** Paint the resting field directly, without any motion. */
  seed(field: FieldState) {
    this.advectDye(0, field, 1);
  }

  private use(name: string) {
    const program = this.programs[name];
    this.gl.useProgram(program.handle);
    return program.u;
  }

  private bind(unit: number, target: Target) {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, target.texture);
    return unit;
  }

  private blit(target: Target | null, width?: number, height?: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo ?? null);
    gl.viewport(0, 0, target?.width ?? width!, target?.height ?? height!);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Sets the palettes and the resting field's uniforms on any program that uses them. */
  field(u: Program["u"], field: FieldState) {
    const gl = this.gl;
    gl.uniform3fv(u.uPaletteA, field.paletteA.labs);
    gl.uniform3fv(u.uPaletteB, field.paletteB.labs);
    gl.uniform2fv(u.uEdgesA, field.paletteA.edges);
    gl.uniform2fv(u.uEdgesB, field.paletteB.edges);
    gl.uniform1f(u.uMix, field.mix);
    gl.uniform1f(u.uTime, field.time);
    gl.uniform1f(u.uAspect, field.aspect);
    gl.uniform1f(u.uSpread, field.spread ? 1 : 0);
    if (u.uReach && this.blend) gl.uniform1i(u.uReach, this.bind(6, this.blend.read));
  }

  /**
   * The fingertip drawn through the liquid from (x0, y0) to (x1, y1), in css px on a `width` ×
   * `height` page, over `dt` seconds: a small body the liquid is dragged along by and parts
   * around (see toolFragment).
   */
  touch(x0: number, y0: number, x1: number, y1: number, dt: number, width: number, height: number) {
    const gl = this.gl,
      tool = this.style.tool,
      velocity = this.velocity!;
    const span = Math.max(dt, 1 / 240),
      scale = this.sim.width / width;
    gl.disable(gl.BLEND);
    const u = this.use("tool");
    gl.uniform1i(u.uVelocity, this.bind(0, velocity.read));
    gl.uniform2f(u.uFrom, x0 / width, 1 - y0 / height);
    gl.uniform2f(u.uTo, x1 / width, 1 - y1 / height);
    gl.uniform1f(u.uAspect, width / height);
    gl.uniform1f(u.uRadius, tool.radius / height);
    gl.uniform1f(u.uEdge, tool.edge / height);
    gl.uniform2f(u.uMove, ((x1 - x0) / span) * scale, ((y0 - y1) / span) * scale);
    gl.uniform1f(u.uCouple, 1 - Math.exp(-tool.couple * span));
    this.blit(velocity.write);
    velocity.swap();

    if (tool.thin) {
      const dye = this.dye!;
      const m = this.use("mark");
      gl.uniform1i(m.uSource, this.bind(0, dye.read));
      gl.uniform2f(m.uFrom, x0 / width, 1 - y0 / height);
      gl.uniform2f(m.uTo, x1 / width, 1 - y1 / height);
      gl.uniform1f(m.uAspect, width / height);
      gl.uniform1f(m.uRadius, (tool.radius * 1.2) / height);
      gl.uniform1f(m.uAmount, tool.thin * Math.min(1, Math.hypot(x1 - x0, y1 - y0) / tool.radius));
      this.blit(dye.write);
      dye.swap();
    }
  }

  /** Draws points additively into a target; their color's channels are what they add. */
  private splat(target: Target, data: Float32Array, count: number, width: number, height: number) {
    const gl = this.gl;
    const u = this.use("paint");
    gl.uniform2f(u.uSize, width, height);
    gl.uniform1f(u.uScale, target.width / width);
    gl.uniform1f(u.uArrive, 0);
    gl.uniform1f(u.uSolid, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.width, target.height);
    gl.bindVertexArray(this.paintVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.paintBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * STRIDE), gl.STREAM_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.disable(gl.BLEND);
  }

  /**
   * Momentum given to the liquid at points, as css px per second in each point's color (x, y
   * down): a small push that the pressure solve turns into a pair of eddies, a mushroom tip.
   */
  impulse(data: Float32Array, count: number, width: number, height: number) {
    if (!count) return;
    const scale = this.sim.width / width;
    for (let i = 0; i < count; i++) {
      data[i * STRIDE + 4] *= scale;
      data[i * STRIDE + 5] *= -scale;
    }
    this.splat(this.velocity!.read, data, count, width, height);
  }

  /**
   * Adds to the scalar the paint carries at points (as much as each point's alpha), leaving its
   * color as it is: milk thickening where a drop's jets carry it.
   */
  thicken(data: Float32Array, count: number, width: number, height: number) {
    if (!count) return;
    const gl = this.gl,
      target = this.dye!.read;
    const u = this.use("paint");
    gl.uniform2f(u.uSize, width, height);
    gl.uniform1f(u.uScale, target.width / width);
    gl.uniform1f(u.uArrive, 0);
    gl.uniform1f(u.uSolid, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.width, target.height);
    gl.bindVertexArray(this.paintVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.paintBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * STRIDE), gl.STREAM_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ZERO, gl.ONE, gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.disable(gl.BLEND);
  }

  /**
   * Blend particle splats of pigment straight into the live dye. The pigment is the color its
   * spot will come to rest at in the arriving palette, so the paint the words become is the very
   * color the field then settles to.
   */
  paint(data: Float32Array, count: number, width: number, height: number, field: FieldState) {
    if (!count) return;
    const gl = this.gl,
      target = this.dye!.read;
    const u = this.use("paint");
    gl.uniform2f(u.uSize, width, height);
    gl.uniform1f(u.uScale, target.width / width);
    gl.uniform1f(u.uArrive, 1);
    gl.uniform1f(u.uSolid, 0);
    gl.uniform2f(u.uTarget, target.width, target.height);
    this.field(u, field);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.width, target.height);
    gl.bindVertexArray(this.paintVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.paintBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * STRIDE), gl.STREAM_DRAW);
    gl.enable(gl.BLEND);
    // The color blends over the paint; the carried scalar is drawn toward the particles' mark.
    gl.blendColor(0, 0, 0, this.style.particle.mark);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.CONSTANT_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
    );
    gl.drawArrays(gl.POINTS, 0, count);
    // Where the words' paint lands, the new palette (and liquid) has arrived.
    if (this.spreading) {
      const blend = this.blend!.read;
      // Never sample the texture being drawn into.
      if (u.uReach) gl.uniform1i(u.uReach, this.bind(6, this.dye!.write));
      gl.uniform1f(u.uSolid, 1);
      gl.uniform1f(u.uScale, blend.width / width);
      gl.bindFramebuffer(gl.FRAMEBUFFER, blend.fbo);
      gl.viewport(0, 0, blend.width, blend.height);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, count);
    }
    gl.disable(gl.BLEND);
  }

  /** A new palette starts spreading from wherever the words' paint lands; nothing has it yet. */
  beginSpread() {
    this.clearReach();
    this.spreading = true;
    this.hold = this.finish = 0;
  }

  /** The new palette has reached everywhere and settled (and `material` with it, if it changed). */
  endSpread(material = this.materials[1]) {
    this.clearReach();
    this.spreading = false;
    this.hold = this.finish = 0;
    this.materials = [material, material];
  }

  private clearReach() {
    const gl = this.gl;
    for (const target of [this.blend!.read, this.blend!.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  step(dt: number, field: FieldState, swirl: number, relax = 0.85) {
    const gl = this.gl;
    const velocity = this.velocity!,
      pressure = this.pressure!;
    const texel = [1 / this.sim.width, 1 / this.sim.height] as const;
    gl.disable(gl.BLEND);

    let u = this.use("forces");
    gl.uniform1i(u.uVelocity, this.bind(0, velocity.read));
    gl.uniform1f(u.uAspect, field.aspect);
    gl.uniform1f(u.uTime, field.time);
    gl.uniform1f(u.uDt, dt);
    const [was, comes] = this.pair ?? [this.style, this.style];
    const both = (pick: (style: MaterialStyle) => number) => [pick(was), pick(comes)] as const;
    gl.uniform1i(u.uBlend, this.bind(3, this.blend!.read));
    gl.uniform2f(u.uAmbient, ...both((style) => style.flow.ambient));
    gl.uniform1f(u.uSwirl, swirl);
    this.blit(velocity.write);
    velocity.swap();

    u = this.use("curl");
    gl.uniform1i(u.uVelocity, this.bind(0, velocity.read));
    gl.uniform2f(u.uTexel, ...texel);
    this.blit(this.curl!);

    u = this.use("vorticity");
    gl.uniform1i(u.uVelocity, this.bind(0, velocity.read));
    gl.uniform1i(u.uCurl, this.bind(1, this.curl!));
    gl.uniform2f(u.uTexel, ...texel);
    gl.uniform1i(u.uBlend, this.bind(3, this.blend!.read));
    gl.uniform2f(u.uStrength, ...both((style) => style.flow.curl));
    gl.uniform1f(u.uDt, dt);
    this.blit(velocity.write);
    velocity.swap();

    u = this.use("divergence");
    gl.uniform1i(u.uVelocity, this.bind(0, velocity.read));
    gl.uniform2f(u.uTexel, ...texel);
    this.blit(this.divergence!);

    u = this.use("fade");
    gl.uniform1i(u.uTexture, this.bind(0, pressure.read));
    gl.uniform1f(u.uValue, 0.8);
    this.blit(pressure.write);
    pressure.swap();

    u = this.use("pressure");
    gl.uniform2f(u.uTexel, ...texel);
    gl.uniform1i(u.uDivergence, this.bind(1, this.divergence!));
    for (let i = 0; i < 20; i++) {
      gl.uniform1i(u.uPressure, this.bind(0, pressure.read));
      this.blit(pressure.write);
      pressure.swap();
    }

    u = this.use("gradient");
    gl.uniform1i(u.uPressure, this.bind(0, pressure.read));
    gl.uniform1i(u.uVelocity, this.bind(1, velocity.read));
    gl.uniform2f(u.uTexel, ...texel);
    this.blit(velocity.write);
    velocity.swap();

    u = this.use("advect");
    gl.uniform1i(u.uVelocity, this.bind(0, velocity.read));
    gl.uniform1i(u.uSource, 0);
    gl.uniform2f(u.uTexel, ...texel);
    gl.uniform1f(u.uDt, dt);
    gl.uniform1i(u.uBlend, this.bind(3, this.blend!.read));
    gl.uniform2f(u.uDissipation, ...both((style) => style.flow.drag));
    this.blit(velocity.write);
    velocity.swap();

    this.advectDye(dt, field, 1 - Math.exp(-dt * relax));

    if (this.spreading) {
      const blend = this.blend!;
      u = this.use("blend");
      gl.uniform1i(u.uVelocity, this.bind(0, velocity.read));
      gl.uniform1i(u.uBlend, this.bind(1, blend.read));
      gl.uniform2f(u.uTexel, ...texel);
      gl.uniform1f(u.uDt, dt);
      const { mode, origin, front } = this.arrival;
      gl.uniform1f(u.uRelax, 1 - Math.exp(-dt * 12));
      gl.uniform1f(u.uHold, this.hold);
      gl.uniform1f(u.uFinish, 1 - Math.exp(-dt * this.finish));
      gl.uniform1f(u.uMode, mode);
      gl.uniform2f(u.uOrigin, ...origin);
      gl.uniform1f(u.uFront, front);
      // How far its edge creeps each step, in uv: about 110 css px a second at its fastest.
      gl.uniform1f(
        u.uStep,
        (110 * Math.max(dt, 1 / 120)) / (this.page / (blend.read.width / blend.read.height)),
      );
      this.field(u, field);
      this.blit(blend.write);
      blend.swap();
    }
  }

  private advectDye(dt: number, field: FieldState, relax: number) {
    const gl = this.gl,
      dye = this.dye!,
      flow = this.style.flow;
    const texel = [1 / this.sim.width, 1 / this.sim.height] as const;
    const sharp = flow.sharp && !!this.ahead && dt > 0;
    if (sharp) {
      const u = this.use("advect");
      gl.uniform1i(u.uVelocity, this.bind(0, this.velocity!.read));
      gl.uniform1i(u.uSource, this.bind(1, dye.read));
      gl.uniform2f(u.uTexel, ...texel);
      gl.uniform1f(u.uDt, dt);
      gl.uniform1i(u.uBlend, this.bind(3, this.blend!.read));
      gl.uniform2f(u.uDissipation, 0, 0);
      this.blit(this.ahead!);
    }
    const u = this.use("dye");
    gl.uniform1i(u.uVelocity, this.bind(0, this.velocity!.read));
    gl.uniform1i(u.uSource, this.bind(1, dye.read));
    if (sharp) gl.uniform1i(u.uAhead, this.bind(2, this.ahead!));
    gl.uniform2f(u.uTexel, ...texel);
    gl.uniform2f(u.uDyeTexel, 1 / dye.read.width, 1 / dye.read.height);
    gl.uniform1f(u.uDt, dt);
    gl.uniform1f(u.uRelax, relax);
    gl.uniform1f(u.uSharp, sharp ? 1 : 0);
    gl.uniform1f(u.uTake, 1 - Math.exp(-dt * 1.4));
    const [was, comes] = this.pair ?? [this.style, this.style];
    gl.uniform1i(u.uBlend, this.bind(3, this.blend!.read));
    gl.uniform2f(u.uRest, was.flow.rest, comes.flow.rest);
    gl.uniform2f(u.uSettle, was.flow.settle, comes.flow.settle);
    gl.uniform2f(u.uVary, was.flow.vary, comes.flow.vary);
    gl.uniform2f(u.uStretch, was.flow.stretch, comes.flow.stretch);
    this.state = field;
    this.field(u, field);
    this.blit(dye.write);
    dye.swap();
  }

  display(
    width: number,
    height: number,
    view: {
      aspect: number;
      time: number;
      scrim: number;
      scrimLightness: number;
      fade: number;
      /** The page size in css px, and the labels laid out in it. */
      view: [number, number];
      /** The corner caption and the hint in the middle. */
      labels: [Label, Label];
      /** The pointer ring: center and radius in css px, and how present it is. */
      ring: [number, number, number, number];
      /** The voice being heard, as the shader's uVoice and uVoiceWave. */
      voice: [number, number, number, number, number, number, number, number];
      /** Where the light stands, in uv with y up, and how high above the painting. */
      light: [number, number, number];
    },
  ) {
    const gl = this.gl;
    const u = this.use("display");
    this.surface(u, 0, view);
    gl.uniform1f(u.uTime, view.time);
    gl.uniform1f(u.uFade, view.fade);
    gl.uniform2f(u.uView, ...view.view);
    const [caption, invite] = view.labels;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, caption.texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, invite.texture);
    gl.uniform1i(u.uCaption, 1);
    gl.uniform1i(u.uInvite, 2);
    gl.uniform4fv(u.uLabelRect, [...caption.rect, ...invite.rect]);
    gl.uniform2f(u.uLabelAlpha, caption.alpha, invite.alpha);
    gl.uniform2f(u.uLabelBlur, caption.blur, invite.blur);
    gl.uniform2f(u.uLabelContrast, caption.contrast, invite.contrast);
    gl.uniform4f(u.uRing, ...view.ring);
    gl.uniform4f(u.uVoice, ...(view.voice.slice(0, 4) as [number, number, number, number]));
    gl.uniform4f(u.uVoiceWave, ...(view.voice.slice(4) as [number, number, number, number]));
    this.blit(null, width, height);
  }

  /**
   * Hands the painting's surface (the dye, its relief, the quiet behind the words) to a program
   * that includes the shared surface shader, with the dye on the given texture unit.
   */
  surface(
    u: Record<string, WebGLUniformLocation>,
    unit: number,
    view: {
      aspect: number;
      scrim: number;
      scrimLightness: number;
      time: number;
      view: [number, number];
      light: [number, number, number];
    },
  ) {
    const gl = this.gl,
      dye = this.dye!.read;
    gl.uniform1i(u.uDye, this.bind(unit, dye));
    gl.uniform2f(u.uTexel, 1 / dye.width, 1 / dye.height);
    gl.uniform1f(u.uAspect, view.aspect);
    gl.uniform1f(u.uScrim, view.scrim);
    gl.uniform1f(u.uScrimLightness, view.scrimLightness);
    gl.uniform1f(u.uRelief, 9 * (Math.min(dye.width, dye.height) / 720));
    gl.uniform2f(u.uFrame, ...view.view);
    gl.uniform3f(u.uLight, ...view.light);
    gl.uniform1i(u.uBlend, this.bind(unit + 4, this.blend!.read));
    gl.uniform2f(u.uMaterials, ...this.materials);
    if (this.state) {
      this.field(u, this.state);
      gl.uniform1f(u.uPaletteMix, this.state.mix);
    }
  }

  /** Start reading the current velocity field back, and pick up the last read once the GPU is done. */
  readFlow() {
    const gl = this.gl;
    if (!this.flowOk || !this.velocity) return;
    if (this.fence) {
      if (gl.clientWaitSync(this.fence, 0, 0) === gl.TIMEOUT_EXPIRED) return;
      gl.deleteSync(this.fence);
      this.fence = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo!);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.flowData);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.flowReady = true;
    }
    const { width, height } = this.sim;
    if (this.flowData.length !== width * height * 4) {
      this.flowData = new Float32Array(width * height * 4);
      this.pbo ??= gl.createBuffer()!;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, this.flowData.byteLength, gl.STREAM_READ);
      this.flowReady = false;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.read.fbo);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo!);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    if (!this.flowChecked) {
      // Some devices cannot read float targets back; particles then simply keep their own motion.
      this.flowChecked = true;
      if (gl.getError() !== gl.NO_ERROR) {
        this.flowOk = false;
        return;
      }
    }
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  }

  /** Velocity at a css-pixel position on a `width` × `height` screen, in css px/s with y down. */
  flowAt(x: number, y: number, width: number, height: number, out: [number, number]) {
    if (!this.flowReady) {
      out[0] = out[1] = 0;
      return out;
    }
    const { width: w, height: h } = this.sim,
      data = this.flowData;
    const gx = Math.min(w - 1.001, Math.max(0, (x / width) * w - 0.5)),
      gy = Math.min(h - 1.001, Math.max(0, (1 - y / height) * h - 0.5));
    const ix = Math.floor(gx),
      iy = Math.floor(gy),
      fx = gx - ix,
      fy = gy - iy;
    const a = (iy * w + ix) * 4,
      b = a + 4,
      c = a + w * 4,
      d = c + 4;
    for (let k = 0; k < 2; k++) {
      const top = data[a + k] + (data[b + k] - data[a + k]) * fx;
      const bottom = data[c + k] + (data[d + k] - data[c + k]) * fx;
      out[k] = top + (bottom - top) * fy;
    }
    out[0] *= width / w;
    out[1] *= -height / h;
    return out;
  }

  /** The live pigment, so particles can take on the hue of the color around them. */
  get pigment() {
    return this.dye!.read.texture;
  }

  private release() {
    const gl = this.gl;
    for (const pair of [this.velocity, this.pressure, this.dye, this.blend])
      if (pair) [pair.read, pair.write].forEach((target) => deleteTarget(gl, target));
    for (const target of [this.divergence, this.curl, this.ahead])
      if (target) deleteTarget(gl, target);
  }

  dispose() {
    const gl = this.gl;
    this.release();
    if (this.fence) gl.deleteSync(this.fence);
    if (this.pbo) gl.deleteBuffer(this.pbo);
    Object.values(this.programs).forEach((program) => gl.deleteProgram(program.handle));
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteBuffer(this.paintBuffer);
    gl.deleteVertexArray(this.quad);
    gl.deleteVertexArray(this.paintVao);
  }
}

/** Interleaved point layout shared by on-screen sparks and field painting. */
export function pointArray(gl: WebGL2RenderingContext) {
  const vao = gl.createVertexArray()!;
  const buffer = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const bytes = STRIDE * 4;
  // position, size, alpha, color, glow, spin, recolor
  [2, 1, 1, 3, 1, 1, 1].reduce((offset, size, location) => {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, bytes, offset * 4);
    return offset + size;
  }, 0);
  gl.bindVertexArray(null);
  return [vao, buffer] as const;
}
