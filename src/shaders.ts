const header = `#version 300 es
precision highp float;
precision highp sampler2D;
`;

const noise = `
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6. - 15.) + 10.);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float value = 0., amplitude = .5;
  for (int i = 0; i < 3; i++) {
    value += amplitude * noise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1;
    amplitude *= .5;
  }
  return value / .875;
}
`;

const oklab = `
vec3 oklabToLinear(vec3 c) {
  float l = c.x + .3963377774 * c.y + .2158037573 * c.z;
  float m = c.x - .1055613458 * c.y - .0638541728 * c.z;
  float s = c.x - .0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.7076147010 * s);
}
vec3 oklabToSrgb(vec3 c) {
  vec3 rgb = clamp(oklabToLinear(c), 0., 1.);
  return mix(rgb * 12.92, 1.055 * pow(rgb, vec3(1. / 2.4)) - .055, step(.0031308, rgb));
}
`;

// The resting image every swirl relaxes back to: the palette laid along one
// warped diagonal, so the model's explicit color order always reads first → last.
const palette = `
uniform vec3 uPaletteA[9], uPaletteB[9];
uniform vec2 uEdgesA[8], uEdgesB[8];
vec3 tone(bool next, float x) {
  x = clamp(x, 0., 1.);
  for (int i = 0; i < 8; i++) {
    vec2 edge = next ? uEdgesB[i] : uEdgesA[i];
    if (x <= edge.x) return next ? uPaletteB[i] : uPaletteA[i];
    if (x < edge.y) {
      return mix(next ? uPaletteB[i] : uPaletteA[i], next ? uPaletteB[i + 1] : uPaletteA[i + 1],
        smoothstep(edge.x, edge.y, x));
    }
  }
  return next ? uPaletteB[8] : uPaletteA[8];
}
`;
const field = `
${palette}
uniform float uMix, uTime, uAspect;
// Where along the palette a point of the resting field falls (the warped diagonal), and how
// much lighter or darker it is shaded there.
vec2 place(vec2 uv) {
  vec2 p = (uv - .5) * vec2(uAspect, 1.);
  float t = uTime;
  vec2 q = vec2(fbm(p * 1.2 + vec2(0., t * .04)), fbm(p * 1.2 + vec2(5.2, 1.3) - vec2(t * .03, 0.)));
  vec2 r = vec2(fbm(p * 1.5 + 3. * q + vec2(1.7, 9.2) + t * .02), fbm(p * 1.5 + 3. * q + vec2(8.3, 2.8) - t * .025));
  vec2 axis = normalize(vec2(.9, .45));
  float extent = .5 * (uAspect * axis.x + axis.y);
  return vec2(dot(p, axis) / (2. * extent) + .5 + (r.x - .5) * 1.6 + (q.y - .5) * .5, (r.y - .5) * .1);
}
// How far the newest palette has reached a point: not by itself, but carried out from where
// the words' paint landed (uReach, while uSpread is on), so the new colors spread from there
// and replace the old ones rather than the old ones turning over in place.
uniform sampler2D uReach;
uniform float uSpread;
float revealAt(vec2 uv) {
  return uSpread > 0. ? smoothstep(.12, .88, texture(uReach, uv).x) : 0.;
}
// The resting field once the newest palette has fully arrived: the color new paint brings to
// a point is exactly the color that point will come to rest at.
vec3 arrival(vec2 uv) {
  vec2 at = place(uv);
  return tone(true, at.x) + vec3(at.y, 0, 0);
}
vec3 field(vec2 uv) {
  vec2 at = place(uv);
  vec3 color = mix(tone(false, at.x), tone(true, at.x), revealAt(uv));
  return color + vec3(at.y, 0, 0);
}
`;

export const quadVertex = `${header}
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * .5 + .5;
  gl_Position = vec4(aPosition, 0., 1.);
}
`;

// The fingertip as a body in the liquid, drawn this frame from uFrom to uTo (uv; its distance
// from the whole stroke, so a quick drag leaves one continuous path). Inside it (uRadius, with a
// soft uEdge, in screen heights) the liquid is drawn toward the fingertip's own velocity at
// uCouple of the difference per step: the water touching it moves with it, and the pressure
// solve that follows sends the rest aside and around it, shedding eddies behind.
export const toolFragment = `${header}
in vec2 vUv;
out vec4 color;
uniform sampler2D uVelocity;
uniform vec2 uMove, uFrom, uTo;
uniform float uAspect, uRadius, uEdge, uCouple;
void main() {
  vec2 v = texture(uVelocity, vUv).xy;
  vec2 p = (vUv - uFrom) * vec2(uAspect, 1.), s = (uTo - uFrom) * vec2(uAspect, 1.);
  float r = length(p - s * clamp(dot(p, s) / max(dot(s, s), 1e-10), 0., 1.));
  float hold = 1. - smoothstep(uRadius, uRadius + uEdge, r);
  color = vec4(v + (uMove - v) * uCouple * hold, 0., 1.);
}
`;

export const forcesFragment = `${header}
in vec2 vUv;
out vec4 color;
uniform sampler2D uVelocity, uBlend;
// Each pair holds the value for the liquid showing and for the one arriving; uBlend says how
// far the arriving one has reached, so a liquid only moves like itself where it is.
uniform vec2 uAmbient;
uniform float uAspect, uTime, uDt, uSwirl;
${noise}
float stream(vec2 p) { return fbm(p * 1.1 + vec2(uTime * .05, -uTime * .04)); }
void main() {
  vec2 velocity = texture(uVelocity, vUv).xy;
  vec2 p = (vUv - .5) * vec2(uAspect, 1.);
  float e = .03;
  vec2 drift = vec2(stream(p + vec2(0, e)) - stream(p - vec2(0, e)), stream(p - vec2(e, 0)) - stream(p + vec2(e, 0))) / (2. * e);
  float r = length(p);
  vec2 force = drift * mix(uAmbient.x, uAmbient.y, texture(uBlend, vUv).x);
  force += vec2(-p.y, p.x) / (r + .08) * uSwirl * exp(-r * r * 3.);
  color = vec4(velocity + force * uDt, 0., 1.);
}
`;

export const curlFragment = `${header}
in vec2 vUv;
out vec4 color;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float l = texture(uVelocity, vUv - vec2(uTexel.x, 0)).y;
  float r = texture(uVelocity, vUv + vec2(uTexel.x, 0)).y;
  float t = texture(uVelocity, vUv + vec2(0, uTexel.y)).x;
  float b = texture(uVelocity, vUv - vec2(0, uTexel.y)).x;
  color = vec4(.5 * (r - l - t + b), 0., 0., 1.);
}
`;

export const vorticityFragment = `${header}
in vec2 vUv;
out vec4 color;
uniform sampler2D uVelocity, uCurl, uBlend;
uniform vec2 uTexel, uStrength;
uniform float uDt;
void main() {
  float l = texture(uCurl, vUv - vec2(uTexel.x, 0)).x;
  float r = texture(uCurl, vUv + vec2(uTexel.x, 0)).x;
  float t = texture(uCurl, vUv + vec2(0, uTexel.y)).x;
  float b = texture(uCurl, vUv - vec2(0, uTexel.y)).x;
  float c = texture(uCurl, vUv).x;
  vec2 force = .5 * vec2(abs(t) - abs(b), abs(r) - abs(l));
  force = force / (length(force) + 1e-4) * mix(uStrength.x, uStrength.y, texture(uBlend, vUv).x) * c;
  force.y *= -1.;
  color = vec4(clamp(texture(uVelocity, vUv).xy + force * uDt, -1000., 1000.), 0., 1.);
}
`;

export const divergenceFragment = `${header}
in vec2 vUv;
out vec4 color;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  vec2 c = texture(uVelocity, vUv).xy;
  float l = vUv.x - uTexel.x < 0. ? -c.x : texture(uVelocity, vUv - vec2(uTexel.x, 0)).x;
  float r = vUv.x + uTexel.x > 1. ? -c.x : texture(uVelocity, vUv + vec2(uTexel.x, 0)).x;
  float t = vUv.y + uTexel.y > 1. ? -c.y : texture(uVelocity, vUv + vec2(0, uTexel.y)).y;
  float b = vUv.y - uTexel.y < 0. ? -c.y : texture(uVelocity, vUv - vec2(0, uTexel.y)).y;
  color = vec4(.5 * (r - l + t - b), 0., 0., 1.);
}
`;

export const fadeFragment = `${header}
in vec2 vUv;
out vec4 color;
uniform sampler2D uTexture;
uniform float uValue;
void main() { color = uValue * texture(uTexture, vUv); }
`;

export const pressureFragment = `${header}
in vec2 vUv;
out vec4 color;
uniform sampler2D uPressure, uDivergence;
uniform vec2 uTexel;
void main() {
  float l = texture(uPressure, vUv - vec2(uTexel.x, 0)).x;
  float r = texture(uPressure, vUv + vec2(uTexel.x, 0)).x;
  float t = texture(uPressure, vUv + vec2(0, uTexel.y)).x;
  float b = texture(uPressure, vUv - vec2(0, uTexel.y)).x;
  color = vec4((l + r + b + t - texture(uDivergence, vUv).x) * .25, 0., 0., 1.);
}
`;

export const gradientFragment = `${header}
in vec2 vUv;
out vec4 color;
uniform sampler2D uPressure, uVelocity;
uniform vec2 uTexel;
void main() {
  float l = texture(uPressure, vUv - vec2(uTexel.x, 0)).x;
  float r = texture(uPressure, vUv + vec2(uTexel.x, 0)).x;
  float t = texture(uPressure, vUv + vec2(0, uTexel.y)).x;
  float b = texture(uPressure, vUv - vec2(0, uTexel.y)).x;
  color = vec4(texture(uVelocity, vUv).xy - vec2(r - l, t - b), 0., 1.);
}
`;

export const advectFragment = `${header}
in vec2 vUv;
out vec4 color;
uniform sampler2D uVelocity, uSource, uBlend;
uniform vec2 uTexel, uDissipation;
uniform float uDt;
void main() {
  vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy * uTexel;
  color = texture(uSource, coord) / (1. + mix(uDissipation.x, uDissipation.y, texture(uBlend, vUv).x) * uDt);
}
`;

// Dye lives in OKLab: advection averages perceptually, so swirled colors stay clean.

// Along the fingertip's stroke the scalar the paint carries is thinned by uAmount in the middle
// and as much heaped up beside it, at twice the width (a film pushed aside: thin in the wake,
// thick along its edges).
export const markFragment = `${header}
in vec2 vUv;
out vec4 color;
uniform sampler2D uSource;
uniform vec2 uFrom, uTo;
uniform float uAspect, uRadius, uAmount;
void main() {
  vec4 paint = texture(uSource, vUv);
  vec2 p = (vUv - uFrom) * vec2(uAspect, 1.), s = (uTo - uFrom) * vec2(uAspect, 1.);
  float r = length(p - s * clamp(dot(p, s) / max(dot(s, s), 1e-10), 0., 1.)), q = r / uRadius;
  color = vec4(paint.xyz, max(paint.w - uAmount * (exp(-q * q) - .25 * exp(-q * q * .25)), 0.));
}
`;

// How far the new palette (and a new liquid with it) has reached: marked where the words' paint
// lands, carried with the flow, and spreading outward from there (uMode 0) as a crisp front, each
// step reaching uStep further where it moves fastest and a third of that where slowest, so its
// edge advances unevenly, like a stain; or, as a tide, flooding out from where the words fell,
// its front uFront screen heights from uOrigin (1). With uHold it hurries, evenly, to reach what
// it has not yet; uFinish fills in the last of it just before the palette settles.
export const blendFragment = `${header}
in vec2 vUv;
out vec4 color;
uniform sampler2D uVelocity, uBlend;
uniform vec2 uTexel, uOrigin;
uniform float uDt, uRelax, uHold, uMode, uFront, uStep, uFinish;
${noise}
${field}
void main() {
  vec2 from = vUv - uDt * texture(uVelocity, vUv).xy * uTexel;
  vec2 frame = vec2(uAspect, 1.);
  float w = texture(uBlend, from).x;
  if (uMode > .5) {
    float d = length((vUv - uOrigin) * frame) + (fbm(vUv * frame * 4.) - .5) * .18;
    w = max(w, 1. - smoothstep(uFront - .03, uFront + .03, d));
  } else {
    // The new color is carried by the water: it reaches furthest downstream, less across the
    // current and least against it, so it is drawn out into streaks along the flow.
    vec2 v = texture(uVelocity, vUv).xy;
    float speed = length(v), drift = clamp(speed * .08, 0., 1.);
    vec2 down = speed > 1e-4 ? v / speed : vec2(0);
    // Its edge frays into fingers: unevenness at two scales, one broad and slow, one fine.
    float broad = smoothstep(.25, .7, fbm(vUv * frame * 4. + uFront * .2));
    float fine = smoothstep(.3, .7, fbm(vUv * frame * 18. - uFront * .5));
    float pace = mix(mix(.25, 1., broad * (.55 + .45 * fine)), 1., uHold);
    float reach = uStep * pace * (1. + 2. * uHold), most = 0., around = 0.;
    for (int k = 0; k < 8; k++) {
      vec2 dir = vec2(cos(float(k) * .785398), sin(float(k) * .785398));
      float along = dot(dir, -down);
      float r = reach * (1. + drift * (1.6 * max(along, 0.) - .6 * max(-along, 0.)));
      float there = texture(uBlend, from + dir * r / frame).x;
      most = max(most, there);
      around += there;
    }
    // A touch of blur keeps the edge soft, as dye's is, without wearing the fingers away.
    w = mix(max(w, most), around / 8., .08);
  }
  color = vec4(mix(w, 1., uFinish), 0., 0., 1.);
}
`;

export const dyeFragment = `${header}
in vec2 vUv;
out vec4 color;
uniform sampler2D uVelocity, uSource, uAhead;
uniform vec2 uTexel, uDyeTexel;
// uSharp corrects the paint carried this step (MacCormack: uAhead is the plain step, which is
// traced back again and half its error taken away, never past the paint it came from), so
// filaments stay as sharp as real dye keeps them.
// uTake is how fast the paint turns to the new palette once the new colors have reached it.
uniform float uDt, uRelax, uSharp, uTake;
// The scalar in the fourth channel drifts back to its resting value at uSettle per second: uRest,
// varied by up to uVary across the page in slow, drifting clouds; each for the liquid showing and
// the one arriving, as far as it has (uBlend).
// Where the flow stretches the paint the scalar thins (uStretch), as a film does.
uniform sampler2D uBlend;
uniform vec2 uRest, uSettle, uVary, uStretch;
${noise}
${field}
void main() {
  vec2 step = uDt * texture(uVelocity, vUv).xy * uTexel, coord = vUv - step;
  vec4 paint = texture(uSource, coord);
  // The scalar is carried plainly: the correction's tiny overshoots would show as grain in it.
  float carried = paint.w;
  if (uSharp > 0.) {
    vec2 base = (floor(coord / uDyeTexel - .5) + .5) * uDyeTexel;
    vec4 a = texture(uSource, base), b = texture(uSource, base + vec2(uDyeTexel.x, 0));
    vec4 c = texture(uSource, base + vec2(0, uDyeTexel.y)), d = texture(uSource, base + uDyeTexel);
    paint = texture(uAhead, vUv) + .5 * (texture(uSource, vUv) - texture(uAhead, vUv + step));
    paint = clamp(paint, min(min(a, b), min(c, d)), max(max(a, b), max(c, d)));
  }
  float b = texture(uBlend, vUv).x, rest = mix(uRest.x, uRest.y, b), vary = mix(uVary.x, uVary.y, b);
  if (vary > 0.) {
    vec2 p = (vUv - .5) * vec2(uAspect, 1.);
    rest += vary * smoothstep(.45, .8, fbm(p * 1.6 + vec2(uTime * .02, -uTime * .013) + 1.5 * fbm(p * .8 - uTime * .01)));
  }
  float keep = uDt > 0. ? exp(-uDt * mix(uSettle.x, uSettle.y, b)) : 0.;
  float stretch = mix(uStretch.x, uStretch.y, b);
  if (stretch > 0.) {
    vec2 l = texture(uVelocity, vUv - vec2(uTexel.x, 0)).xy, r = texture(uVelocity, vUv + vec2(uTexel.x, 0)).xy;
    vec2 d = texture(uVelocity, vUv - vec2(0, uTexel.y)).xy, u = texture(uVelocity, vUv + vec2(0, uTexel.y)).xy;
    float strain = length(vec2((r.x - l.x) - (u.y - d.y), (u.x - d.x) + (r.y - l.y))) * .5;
    carried *= exp(-stretch * strain * uDt);
  }
  // Where the new colors have reached, the paint turns to them quickly, but only in its broad
  // color: its own fine structure (the filaments and folds the flow has drawn) carries over, so
  // the swirls go on and only their colors change, rather than washing out into the new field.
  vec3 settled = mix(paint.xyz, field(vUv), uRelax);
  float take = revealAt(vUv) * uTake;
  if (take > 0.) {
    vec2 e = uDyeTexel * 4.;
    vec3 broad = (texture(uSource, coord + vec2(e.x, 0)).xyz + texture(uSource, coord - vec2(e.x, 0)).xyz
      + texture(uSource, coord + vec2(0, e.y)).xyz + texture(uSource, coord - vec2(0, e.y)).xyz) * .25;
    settled = mix(settled, field(vUv) + (paint.xyz - broad) * vec3(.9, .6, .6), take);
  }
  color = vec4(settled, mix(rest, carried, keep));
}
`;

// Ink: a color for words drawn into the painting, worked out from the paint right behind it.
const ink = `
${oklab}
float luminance(vec3 rgb) {
  return dot(pow(clamp(rgb, 0., 1.), vec3(2.4)), vec3(.2126729, .7151522, .072175));
}
// APCA (W3 0.0.98G): soft black clamp, and the lightness contrast of text over a background.
float soft(float y) {
  return y + pow(max(.022 - y, 0.), 1.414);
}
float apca(float text, float back) {
  text = soft(text);
  back = soft(back);
  return back > text ? (pow(back, .56) - pow(text, .57)) * 1.14 - .027 : (pow(text, .62) - pow(back, .65)) * 1.14 - .027;
}
// The text luminance that reaches a given contrast over a background, darker or lighter;
// as far as it goes when the background leaves too little room.
float darker(float back, float target) {
  return pow(max(pow(soft(back), .56) - (target + .027) / 1.14, 0.), 1. / .57);
}
float lighter(float back, float target) {
  return min(pow(pow(soft(back), .65) + (target + .027) / 1.14, 1. / .62), 1.);
}
// The most chroma a hue can carry at a lightness and still be a displayable color.
float reach(float lightness, vec2 hue) {
  float low = 0., high = .37;
  for (int i = 0; i < 7; i++) {
    float mid = (low + high) * .5;
    vec3 rgb = oklabToLinear(vec3(lightness, hue * mid));
    if (all(greaterThanEqual(rgb, vec3(-.001))) && all(lessThanEqual(rgb, vec3(1.001)))) low = mid;
    else high = mid;
  }
  return low;
}
// The paint's own hue at another luminance, as vivid as that lightness allows: the more
// colorful the paint, the closer the ink comes to the most colorful it can be there, so text
// reads as a clear tint of what lies beneath rather than a near-white or a near-black. Grey
// paint keeps grey ink.
vec3 shade(vec3 c, float y) {
  float chroma = length(c.yz);
  vec2 hue = chroma > 1e-4 ? c.yz / chroma : vec2(0);
  vec3 s = vec3(pow(y, 1. / 3.), 0, 0);
  for (int i = 0; i < 3; i++) {
    s.yz = hue * min(reach(s.x, hue) * .92, chroma * 2.4);
    s.x = clamp(s.x * pow(max(y, 1e-5) / max(luminance(oklabToSrgb(s)), 1e-5), 1. / 3.), 0., 1.);
  }
  s.yz = hue * min(reach(s.x, hue) * .92, chroma * 2.4);
  return oklabToSrgb(s);
}
// The paint under a pixel moved just far enough in lightness to read at a contrast: toward
// dark where dark is 1 and toward light where it is 0.
vec3 inkFor(vec3 c, float y, float dark, float contrast) {
  return dark > .999 ? shade(c, darker(y, contrast)) : dark < .001 ? shade(c, lighter(y, contrast))
    : mix(shade(c, lighter(y, contrast)), shade(c, darker(y, contrast)), dark);
}
// Which way the ink goes over a background luminance: 1 toward dark, 0 toward light, flipping
// along a crisp antialiased contour where the paint crosses from one side to the other.
float darkness(float y) {
  float lean = apca(0., y) - apca(1., y);
  float edge = max(fwidth(lean) * .75, 1e-4);
  return smoothstep(-edge, edge, lean);
}
`;

// The painting as it appears on screen at a point, in OKLab: the dye, lit as folds of silk,
// softened behind the words while someone writes, and darkened toward the edges. Every pass that
// draws words in ink reads the same surface, so they all agree on the color behind them.
const surface = `
${palette}
// How far the palette has turned to the new one (the field's mix), for colors taken from it.
uniform float uPaletteMix;
uniform sampler2D uDye;
uniform vec2 uTexel;
uniform float uAspect, uScrim, uScrimLightness, uRelief;
// The page in css px, for detail that keeps its size on any screen.
uniform vec2 uFrame;
// The light: where it stands over the painting, in uv, and how high above it.
uniform vec3 uLight;
float scrimAt(vec2 uv) {
  vec2 s = (uv - .5) * vec2(uAspect, 1.) * vec2(1.15 / max(uAspect, 1.), 2.4);
  return exp(-dot(s, s) * 2.2) * uScrim;
}
// Behind the words the paint quiets a little, never into a grey veil; the edges sink into shade.
vec3 quiet(vec3 c, vec2 uv) {
  float scrim = scrimAt(uv);
  c.x = mix(c.x, uScrimLightness, scrim * .14);
  c.yz *= 1. - scrim * .2;
  c.x *= 1. - .2 * smoothstep(.3, 1., length((uv - .5) * 1.7));
  return c;
}
vec3 lightAt(vec2 uv) {
  return normalize(vec3((uLight.xy - uv) * vec2(uAspect, 1.), uLight.z));
}
vec3 silk(vec2 uv) {
  vec3 c = texture(uDye, uv).xyz;
  float l = texture(uDye, uv - vec2(uTexel.x, 0)).x;
  float r = texture(uDye, uv + vec2(uTexel.x, 0)).x;
  float b = texture(uDye, uv - vec2(0, uTexel.y)).x;
  float t = texture(uDye, uv + vec2(0, uTexel.y)).x;
  // Lightness becomes height: swirls read as folds of silk under a soft key light.
  vec3 normal = normalize(vec3((l - r) * uRelief, (b - t) * uRelief, 1.));
  vec3 light = normalize(vec3(-.45, .6, .65));
  vec3 halfway = normalize(light + vec3(0, 0, 1));
  float diffuse = dot(normal, light) - light.z;
  float specular = max(pow(max(dot(normal, halfway), 0.), 40.) - pow(halfway.z, 40.), 0.);
  c.x += diffuse * .12 + specular * .16 * (.35 + c.x);
  return c;
}
// A soap film or oil slick over the water. Its thickness h (hundreds of nm; the paint's carried
// amount, 0 to 1, spans 0.8 to 7.8 of them, so no part of it is ever a hole) sets the path
// difference light takes through it, 2·n·h, longer at a slant (as the light moves away the
// bands slide); each of three of the palette's colors sounds at its own wavelength, so the bands
// keep their real order (black film where thinnest, then silvery white, then ever paler orders
// as it thickens) in the palette's hues, laid over the paint like a sheen. Bands finer than a
// pixel fade rather than break into confetti.
vec3 linearToOklab(vec3 c) {
  vec3 lms = pow(max(vec3(
    .4122214708 * c.r + .5363325363 * c.g + .0514459929 * c.b,
    .2119034982 * c.r + .6806995451 * c.g + .1073969566 * c.b,
    .0883024619 * c.r + .2817188376 * c.g + .6299787005 * c.b), 0.), vec3(1. / 3.));
  return vec3(
    .2104542553 * lms.x + .7936177850 * lms.y - .0040720468 * lms.z,
    1.9779984951 * lms.x - 2.4285922050 * lms.y + .4505937099 * lms.z,
    .0259040371 * lms.x + .7827717662 * lms.y - .8086757660 * lms.z);
}
vec3 film(vec2 uv) {
  vec4 here = texture(uDye, uv);
  float h = clamp(.8 + here.w * 7., 0., 15.);
  vec2 off = (uLight.xy - uv) * vec2(uAspect, 1.);
  float slant = mix(.75, 1., exp(-dot(off, off) * 6.));
  float path = 2. * 1.38 * h * 100. / slant;
  float near = max(abs(texture(uDye, uv + vec2(uTexel.x, 0)).w - here.w), abs(texture(uDye, uv + vec2(0, uTexel.y)).w - here.w)) * 7.;
  float black = smoothstep(.2, .7, h);
  float amplitude = exp(-pow(path / 1500., 2.)) * exp(-pow(near * 276. / 220., 2.)) * black;
  float waves[3] = float[3](650., 540., 450.);
  vec3 sheen = vec3(0);
  for (int i = 0; i < 3; i++) {
    float x = float(i) * .5;
    vec3 tint = mix(tone(false, x), tone(true, x), uPaletteMix);
    sheen += clamp(oklabToLinear(tint + vec3(.15, 0, 0)), 0., 1.) * (.5 - .5 * cos(6.2832 * path / waves[i]));
  }
  vec3 base = here.xyz;
  base.x *= .8 - .12 * (1. - black);
  vec3 under = clamp(oklabToLinear(base), 0., 1.);
  vec3 lit = 1. - (1. - under) * (1. - sheen / 3. * amplitude * .7);
  vec3 c = linearToOklab(lit);
  vec3 light = lightAt(uv);
  c.x += pow(max(normalize(light + vec3(0, 0, 1)).z, 0.), 90.) * .2;
  return c;
}
// Milk clouding the tea. Milk scatters light so strongly that even thin milk is nearly opaque
// (opacity 1 - e^(-8m) of its density m, 1.4 times the paint's carried amount): bright, soft cores in a pale shade of the paint's own
// hue over the tea, a deep shade of it. It hardly absorbs, so the shade inside it is soft: milk
// between a point and the light scatters the light away (a few taps toward the light); the lobes
// of a cloud catch the light rather than the whole of it (relief from its finer structure only);
// its thinnest fringes lean a little blue and glow where the light comes through from behind;
// and it casts a faint shadow on the tea beneath.
float densityAt(vec2 uv) {
  return max(texture(uDye, uv).w, 0.) * 1.4;
}
vec3 milk(vec2 uv) {
  vec3 paint = texture(uDye, uv).xyz;
  float m = densityAt(uv), a = 1. - exp(-8. * m);
  vec3 light = lightAt(uv);
  vec2 toward = normalize(light.xy + 1e-4) * uTexel * 2.5;
  float between = 0.;
  for (int i = 1; i <= 6; i++) between += densityAt(uv + toward * float(i));
  float through = exp(-.2 * between);
  vec2 e = uTexel * 3., E = uTexel * 10.;
  vec2 fine = vec2(densityAt(uv + vec2(e.x, 0)) - densityAt(uv - vec2(e.x, 0)), densityAt(uv + vec2(0, e.y)) - densityAt(uv - vec2(0, e.y))) / 6.;
  vec2 broad = vec2(densityAt(uv + vec2(E.x, 0)) - densityAt(uv - vec2(E.x, 0)), densityAt(uv + vec2(0, E.y)) - densityAt(uv - vec2(0, E.y))) / 20.;
  vec3 n = normalize(vec3(-(fine - broad) * 2.5, 1.));
  float lit = clamp(.9 + (dot(n, light) - light.z) * .8, .82, 1.);
  vec3 tea = vec3(paint.x * .4, paint.yz * .7);
  tea.x *= 1. - .15 * (1. - exp(-8. * densityAt(uv - toward * 4.)));
  vec3 cream = vec3((.62 + .3 * paint.x) * mix(.7, 1., through) * lit, paint.yz * .85);
  float thin = a * (1. - a) * 4.;
  float behind = max(dot(-normalize(fine + 1e-5), normalize(light.xy + 1e-4)), 0.);
  cream.z -= .015 * thin;
  cream.x += .04 * thin * behind;
  return mix(tea, cream, a);
}
// Each liquid's look, by its number: silk, film, milk.
vec3 look(float material, vec2 uv) {
  if (material < .5) return silk(uv);
  if (material < 1.5) return film(uv);
  return milk(uv);
}
// The material being left (uMaterials.x) and the one arriving (uMaterials.y). Where the new one
// has reached, carried in with the new paint (uBlend), the surface turns into it; the rest is
// still the old one, so a change of material soaks in with the color, never all at once.
uniform sampler2D uBlend;
uniform vec2 uMaterials;
float arrived(vec2 uv) {
  return uMaterials.x == uMaterials.y ? 0. : clamp(texture(uBlend, uv).x, 0., 1.);
}
vec3 surface(vec2 uv) {
  float w = arrived(uv);
  vec3 c = w < 1. ? look(uMaterials.x, uv) : vec3(0);
  if (w > 0.) c = mix(c, look(uMaterials.y, uv), w);
  return quiet(c, uv);
}
// The paint the words are inked against.
vec3 calm(vec2 uv) {
  return surface(uv);
}
`;

export const displayFragment = `${header}
in vec2 vUv;
out vec4 color;
uniform float uTime, uFade;
uniform vec2 uView;
// Two labels drawn into the painting: the corner caption and the hint in the middle.
uniform sampler2D uCaption, uInvite;
uniform vec4 uLabelRect[2];
uniform vec2 uLabelAlpha, uLabelBlur, uLabelContrast;
// The pointer: center and radius in css px, and how present it is.
uniform vec4 uRing;
// A voice being heard: center in css px, how present it is, how far the finger has strayed
// toward letting go of it; then how loud, the ripples' phase, how far it has turned to
// waiting for the words, and time.
uniform vec4 uVoice, uVoiceWave;
${noise}
${ink}
${surface}
bool covers(vec2 point, vec4 rect, float pad) {
  return rect.z > 0. && all(greaterThanEqual(point, rect.xy - pad)) && all(lessThanEqual(point, rect.xy + rect.zw + pad));
}
// Draws a label's strokes in ink; emoji keep their own colors. A label can soften as it
// fades, as if out of focus.
vec3 label(vec3 rgb, vec3 c, float y, float dark, vec2 point, sampler2D words, vec4 rect, float alpha, float blur, float contrast) {
  if (alpha < .001 || !covers(point, rect, blur)) return rgb;
  vec2 q = (point - rect.xy) / rect.zw;
  vec2 spread = blur / rect.zw;
  vec4 glyph = texture(words, q);
  if (blur > .05) {
    // A disc of taps along a golden-angle spiral: an even, lens-like softness.
    glyph = vec4(0);
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 2.39996;
      glyph += texture(words, q + spread * sqrt((float(i) + .5) / 16.) * vec2(cos(a), sin(a)));
    }
    glyph /= 16.;
  }
  if (glyph.a < .002) return rgb;
  vec3 own = glyph.rgb / glyph.a;
  float neutral = 1. - smoothstep(.04, .14, max(own.r, max(own.g, own.b)) - min(own.r, min(own.g, own.b)));
  vec3 ink = inkFor(c, y, dark, contrast);
  return mix(rgb, mix(own, ink, neutral), glyph.a * alpha);
}
void main() {
  vec3 c = surface(vUv);
  vec3 rgb = oklabToSrgb(c);

  // Label ink is decided pixel by pixel: the paint right under it, its hue and chroma, only
  // lighter or darker, by just as much as the label needs to read (APCA). Over dark paint it
  // is a paler shade, over light paint a deeper one; only mid-tones, which leave little room
  // either way, push it near black or white. Where the paint crosses from one side to the
  // other the ink flips along a crisp, antialiased contour that drifts with the flow; a blend
  // there would pass through the paint's own tone and vanish.
  vec2 point = vec2(vUv.x, 1. - vUv.y) * uView;
  float px = fwidth(point.x);
  float around = length(point - uRing.xy) - uRing.z;
  bool ring = uRing.w > .001 && abs(around) < 3.;
  if (covers(point, uLabelRect[0], 8.) || covers(point, uLabelRect[1], 8.) || ring) {
    // Ink is chosen against the paint without the material's fine detail, so it holds steady.
    vec3 k = calm(vUv);
    float y = luminance(oklabToSrgb(k));
    float dark = darkness(y);
    rgb = label(rgb, k, y, dark, point, uCaption, uLabelRect[0], uLabelAlpha.x, uLabelBlur.x, uLabelContrast.x);
    rgb = label(rgb, k, y, dark, point, uInvite, uLabelRect[1], uLabelAlpha.y, uLabelBlur.y, uLabelContrast.y);
    // The pointer: a fine ring in the same kind of ink, a tint of whatever it passes over.
    if (ring) {
      float stroke = 1. - smoothstep(.65 - px * .5, .65 + px * .5, abs(around));
      rgb = mix(rgb, inkFor(k, y, dark, .45), stroke * uRing.w);
    }
  }
  // Listening: a point of ink with a fine ring around it where the finger rests. As the voice
  // rises the point swells and ripples run outward through the paint; when the finger strays
  // toward letting go they thin away; once released the point draws in and breathes until the
  // words arrive.
  if (uVoice.z > .001) {
    vec2 d = point - uVoice.xy;
    float r = length(d);
    if (r < 130.) {
      float level = uVoiceWave.x, heard = uVoiceWave.z, time = uVoiceWave.w;
      vec3 k = calm(vUv);
      float y = luminance(oklabToSrgb(k));
      vec3 tint = inkFor(k, y, darkness(y), .45);
      float angle = atan(d.y, d.x);
      // Rings on water, not on paper: every edge wavers a little with the angle and with time.
      float waver = sin(angle * 3. + time * 1.3) * .6 + sin(angle * 5. - time * 1.9) * .4;
      float core = mix(4. + level * 6. + .7 * sin(time * 2.2), 2.4 + 1.1 * sin(time * 3.1), heard);
      float a = 1. - smoothstep(core - px * .7, core + px * .7, r);
      float halo = 18. + level * 7. + waver * (.4 + level * .9);
      a = max(a, exp(-pow((r - halo) / (.7 + level * .5), 2.)) * .55 * (1. - heard));
      for (int i = 0; i < 3; i++) {
        float f = fract(uVoiceWave.y + float(i) / 3.);
        float spread = mix(halo, 112., f) + waver * f * 3.5;
        // A ripple leaves fine and clear, and widens and fades as it travels.
        float width = mix(.7, 7., f * f);
        float strength = pow(1. - f, 1.3) * smoothstep(0., .1, f) * min(level * 1.5, 1.) * (1. - heard);
        a = max(a, exp(-pow((r - spread) / width, 2.)) * strength * mix(.8, .3, f));
      }
      rgb = mix(rgb, tint, a * uVoice.z * (1. - uVoice.w * .85));
    }
  }
  rgb += (hash(gl_FragCoord.xy + fract(uTime * 7.) * 91.) - .5) * (4. / 255.);
  color = vec4(rgb * uFade, 1.);
}
`;

/** The contrast, APCA Lc, the words being written keep with the paint behind them. */
export const WRITING_CONTRAST = 0.42;

// The words being written, one quad per character, each drawn in ink. A character condenses
// out of the paint: it arrives soft and faint, a little low, and settles sharp into place over
// its first moments. When the lines reflow or the size changes, characters glide to their new
// places rather than jump. The caret is one more quad, a fine line of the same ink.
export const writingVertex = `${header}
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aBox;
layout(location = 2) in vec4 aSource;
layout(location = 3) in vec3 aState;
uniform vec2 uView;
out vec2 vPoint;
out vec4 vBox, vSource;
out vec3 vState;
void main() {
  float settle = clamp(aState.x, 0., 1.);
  float pad = (1. - settle) * aBox.w * .3 + 2.;
  vec2 css = aBox.xy - pad + aCorner * (aBox.zw + pad * 2.);
  vPoint = css;
  vBox = aBox;
  vSource = aSource;
  vState = aState;
  gl_Position = vec4(css.x / uView.x * 2. - 1., 1. - css.y / uView.y * 2., 0., 1.);
}
`;

export const writingFragment = `${header}
in vec2 vPoint;
in vec4 vBox, vSource;
in vec3 vState;
out vec4 color;
uniform sampler2D uWords;
uniform vec2 uView;
uniform float uContrast;
${ink}
${surface}
void main() {
  vec2 uv = vec2(vPoint.x / uView.x, 1. - vPoint.y / uView.y);
  vec3 c = calm(uv);
  float y = luminance(oklabToSrgb(c));
  vec3 tint = inkFor(c, y, darkness(y), uContrast);
  // The caret: no source, a thin bar whose presence breathes.
  if (vSource.z <= 0.) {
    vec2 d = abs(vPoint - (vBox.xy + vBox.zw * .5)) - vBox.zw * .5;
    float a = clamp(.5 - max(d.x, d.y), 0., 1.) * vState.x * vState.z;
    color = vec4(tint * a, a);
    return;
  }
  float settle = clamp(vState.x, 0., 1.);
  float ease = 1. - pow(1. - settle, 3.);
  // Where in the character this pixel falls, from a box that starts a touch lower.
  vec2 at = (vPoint - vBox.xy - vec2(0, (1. - ease) * vBox.w * .12)) / vBox.zw;
  vec2 q = vSource.xy + at * vSource.zw;
  vec2 texel = vSource.zw / vBox.zw;
  vec4 glyph;
  float blur = (1. - ease) * vBox.w * .22;
  if (blur > .3) {
    // A disc of taps along a golden-angle spiral: an even, lens-like softness.
    glyph = vec4(0);
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 2.39996;
      glyph += texture(uWords, q + texel * blur * sqrt((float(i) + .5) / 12.) * vec2(cos(a), sin(a)));
    }
    glyph /= 12.;
  } else {
    glyph = texture(uWords, q);
  }
  // Characters own only their box (with room for the blur), never a neighbor's strokes.
  vec2 margin = abs(at - .5) - .5 - blur / vBox.zw;
  glyph *= step(max(margin.x, margin.y), 0.);
  float selected = vState.y;
  float a = glyph.a * smoothstep(0., .7, settle);
  vec3 own = glyph.a > .002 ? glyph.rgb / glyph.a : vec3(1);
  float neutral = 1. - smoothstep(.04, .14, max(own.r, max(own.g, own.b)) - min(own.r, min(own.g, own.b)));
  vec3 stroke = mix(own, tint, neutral);
  // A selection is a soft wash of the same ink behind the characters.
  vec2 inside = abs(vPoint - (vBox.xy + vBox.zw * .5)) - vBox.zw * .5;
  float wash = selected * .18 * clamp(.5 - max(inside.x, inside.y), 0., 1.);
  float alpha = a + wash * (1. - a);
  color = vec4(stroke * a + tint * wash * (1. - a), alpha) * vState.z;
}
`;

export const pointVertex = `${header}
layout(location = 0) in vec2 aPosition;
layout(location = 1) in float aSize;
layout(location = 2) in float aAlpha;
layout(location = 3) in vec3 aColor;
layout(location = 4) in float aGlow;
layout(location = 5) in float aSpin;
layout(location = 6) in float aRecolor;
uniform vec2 uSize;
uniform float uScale;
out vec3 vColor;
out float vAlpha, vGlow, vSoft, vSpin, vSize, vRecolor;
void main() {
  vSoft = clamp((aSize - 6.) / 18., 0., 1.);
  gl_Position = vec4(aPosition.x / uSize.x * 2. - 1., 1. - aPosition.y / uSize.y * 2., 0., 1.);
  gl_PointSize = max(aSize * uScale, 1.);
  vColor = aColor;
  vAlpha = aAlpha;
  vGlow = aGlow;
  vSpin = aSpin;
  vSize = gl_PointSize;
  vRecolor = aRecolor;
}
`;

// Premultiplied output; glow 1 is purely additive light, glow 0 is opaque ink.
export const pointFragment = `${header}
in vec3 vColor;
in float vAlpha, vGlow, vSoft, vSpin, vSize, vRecolor;
out vec4 color;
uniform sampler2D uDye;
uniform vec2 uView;
uniform float uAdopt, uContrast;
// The particles' shape (see sprite) as the words came apart, and the one they take on as the
// answer arrives in a new material, uShapeMix of the way; the light, as in the surface.
uniform float uShape, uShapeTo, uShapeMix;
uniform vec3 uTone;
uniform vec3 uLight;
${ink}
${noise}
${field}
vec3 srgbToOklab(vec3 c) {
  c = mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c));
  vec3 lms = pow(max(vec3(
    .4122214708 * c.r + .5363325363 * c.g + .0514459929 * c.b,
    .2119034982 * c.r + .6806995451 * c.g + .1073969566 * c.b,
    .0883024619 * c.r + .2817188376 * c.g + .6299787005 * c.b), 0.), vec3(1. / 3.));
  return vec3(
    .2104542553 * lms.x + .7936177850 * lms.y - .0040720468 * lms.z,
    1.9779984951 * lms.x - 2.4285922050 * lms.y + .4505937099 * lms.z,
    .0259040371 * lms.x + .7827717662 * lms.y - .8086757660 * lms.z);
}
// One particle drawn as a shape (0 a soft dot, 1 a tumbling shard, 2 a glossy drop) in a hue;
// returns the color it shows and its coverage.
vec4 sprite(float shape, vec3 hue) {
  vec2 q = (gl_PointCoord - .5) * 2.;
  float r = length(q), edge = 2.4 / max(vSize, 1.);
  if (shape < .5) return vec4(hue, mix(smoothstep(1., .3, r), exp(-r * r * 4.) * (1. - r), vSoft));
  if (shape < 1.5) {
    // A slender rhombus turning as it falls: its two faces take the light in turn, and now
    // and then one flashes.
    vec2 s = mat2(cos(vSpin), sin(vSpin), -sin(vSpin), cos(vSpin)) * q;
    float tilt = sin(vSpin * 1.7 + sign(s.x) * 1.1);
    return vec4(hue * (.82 + .3 * tilt) + pow(max(tilt, 0.), 14.) * .7, 1. - smoothstep(1. - edge * 1.6, 1., abs(s.x) / .45 + abs(s.y)));
  }
  // A glossy drop: deeper toward its rim, with a highlight toward the light.
  vec3 n = vec3(q, sqrt(max(1. - r * r, 0.)));
  vec2 at = gl_FragCoord.xy / uView;
  vec3 light = normalize(vec3((uLight.xy - at) * vec2(uView.x / uView.y, 1.), uLight.z));
  float shine = pow(max(dot(n, normalize(light + vec3(0, 0, 1))), 0.), 24.);
  return vec4(hue * (.3 + .8 * n.z) + shine * .85, 1. - smoothstep(1. - edge, 1., r));
}
void main() {
  // Particles of neutral ink are made of the painting, like the words they came from: the
  // color around them, lighter or darker just enough to read. Colourful particles (from an
  // emoji, say) keep their own; once the answer arrives they all show their own colors.
  vec3 own = srgbToOklab(vColor), local = texture(uDye, gl_FragCoord.xy / uView).xyz;
  float adopt = clamp(uAdopt / .55, 0., 1.) * (1. - smoothstep(.03, .09, length(own.yz)));
  float y = luminance(oklabToSrgb(local));
  vec3 hue = mix(vColor, inkFor(local, y, darkness(y), uContrast), adopt);
  // Once the answer arrives it takes on the color its spot will come to rest at, in the shade
  // its liquid shows it in (uTone: lightness scale and lift, chroma scale).
  if (vRecolor > 0.) {
    vec3 rest = arrival(gl_FragCoord.xy / uView);
    rest = vec3(rest.x * uTone.x + uTone.y, rest.yz * uTone.z);
    hue = mix(hue, oklabToSrgb(rest), vRecolor);
  }
  vec4 from = sprite(uShape, hue), to = sprite(uShapeTo, hue);
  vec3 seen = mix(from.rgb, to.rgb, uShapeMix);
  float a = mix(from.a, to.a, uShapeMix);
  // Once the new colors have reached where it floats it melts into them, being their color.
  a *= vAlpha * (1. - .7 * vRecolor * revealAt(gl_FragCoord.xy / uView));
  color = vec4(seen * a, a * (1. - vGlow));
}
`;

// With uArrive, the pigment is the color its spot will come to rest at, not the point's own.
export const paintFragment = `${header}
in vec3 vColor;
in float vAlpha;
out vec4 color;
// uSolid paints a plain 1, for marking where a new material has arrived.
uniform float uArrive, uSolid;
uniform vec2 uTarget;
${noise}
${field}
void main() {
  float r = length(gl_PointCoord - .5) * 2.;
  vec3 pigment = uSolid > 0. ? vec3(1) : uArrive > 0. ? arrival(gl_FragCoord.xy / uTarget) : vColor;
  color = vec4(pigment, exp(-r * r * 4.) * step(r, 1.) * vAlpha);
}
`;

// The words as one solid layer, pixel-identical to the DOM text they replace, colors and all
// (emoji keep theirs). The glyphs are premultiplied; a second texture holds each pixel's
// erosion threshold.
export const wordsVertex = `${header}
layout(location = 0) in vec2 aPosition;
uniform vec4 uRect;
uniform vec2 uSize;
out vec2 vUv;
void main() {
  vec2 corner = aPosition * .5 + .5;
  vUv = vec2(corner.x, 1. - corner.y);
  vec2 css = uRect.xy + vUv * uRect.zw;
  gl_Position = vec4(css.x / uSize.x * 2. - 1., 1. - css.y / uSize.y * 2., 0., 1.);
}
`;

export const wordsFragment = `${header}
in vec2 vUv;
out vec4 color;
uniform sampler2D uGlyphs, uOrder;
uniform float uFront, uContrast;
uniform vec3 uRim;
uniform vec2 uView;
${ink}
${surface}
void main() {
  if (vUv.x > 1. || vUv.y > 1.) discard;
  vec4 glyph = texture(uGlyphs, vUv);
  float order = texture(uOrder, vUv).r;
  float keep = smoothstep(uFront, uFront + .03, order);
  float rim = glyph.a * (1. - smoothstep(0., .045, abs(order - uFront)));
  // Neutral strokes are drawn in the ink the words had while being written; emoji keep color.
  vec3 own = glyph.a > .002 ? glyph.rgb / glyph.a : vec3(1);
  float neutral = 1. - smoothstep(.04, .14, max(own.r, max(own.g, own.b)) - min(own.r, min(own.g, own.b)));
  vec3 c = calm(gl_FragCoord.xy / uView);
  float y = luminance(oklabToSrgb(c));
  vec3 stroke = mix(own, inkFor(c, y, darkness(y), uContrast), neutral) * glyph.a;
  color = vec4(stroke * keep + uRim * rim * .65, glyph.a * keep);
}
`;
