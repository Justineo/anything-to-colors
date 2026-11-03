import { Atelier } from "../src/engine";

const options = {
  a: {
    colors: ["#101B56", "#2854D9", "#5189EC", "#A0C8FA"],
    ink: "#F4F8FF",
    shade: "linear-gradient(90deg, #0a123c77, #0a123c05 85%)",
  },
  b: {
    colors: ["#3F154A", "#8C2879", "#DE668F", "#F4ACAA"],
    ink: "#FFF4F8",
    shade: "linear-gradient(90deg, #350f3877, #350f3805 85%)",
  },
  c: {
    colors: ["#073C43", "#0A7B80", "#3EB6A4", "#B4E4CA"],
    ink: "#EFFDF5",
    shade: "linear-gradient(90deg, #07313677, #07313605 85%)",
  },
  d: {
    colors: ["#ECE4FF", "#D1BDF2", "#A992DE", "#7963B4"],
    ink: "#30204F",
    shade: "linear-gradient(90deg, #f8f2ff44, #f8f2ff00 85%)",
  },
  e: {
    colors: ["#FFE5CE", "#FBC6A3", "#ED9D8F", "#CC738C"],
    ink: "#542638",
    shade: "linear-gradient(90deg, #fff2e444, #fff2e400 85%)",
  },
  f: {
    colors: ["#F7FAD7", "#DEF0B8", "#A7D7BE", "#73B9B7"],
    ink: "#174943",
    shade: "linear-gradient(90deg, #ffffee44, #ffffee00 85%)",
  },
};
// Extra main-color stops leave less of the pigment field to the contrasting accent.
const accentOptions = {
  "a-coral": {
    ...options.a,
    colors: ["#101B56", "#2854D9", "#5189EC", "#7CA9F2", "#A0C8FA", "#FF866D"],
  },
  "a-lemon": {
    ...options.a,
    colors: ["#101B56", "#2854D9", "#5189EC", "#7CA9F2", "#A0C8FA", "#F5E66B"],
  },
  "c-orange": {
    ...options.c,
    colors: ["#073C43", "#0A7B80", "#269C98", "#3EB6A4", "#A9DFCB", "#FF8D69"],
  },
  "d-lime": {
    ...options.d,
    colors: ["#ECE4FF", "#D1BDF2", "#B9A1E6", "#A992DE", "#9482C9", "#D6EF74"],
  },
  "e-blue": {
    ...options.e,
    colors: ["#FFE5CE", "#FBC6A3", "#F4B19A", "#ED9D8F", "#DF8893", "#4D78CF"],
  },
  "f-berry": {
    ...options.f,
    colors: ["#F7FAD7", "#DEF0B8", "#BFE2BD", "#A7D7BE", "#8AC5B7", "#B86AAB"],
  },
};
const moreAccentOptions = {
  "g-ocean": {
    ...options.a,
    colors: ["#101B48", "#2452A6", "#4A86CB", "#83B5DA", "#80D9C2", "#FFB085"],
  },
  "h-iris": {
    ...options.b,
    colors: ["#2A1B58", "#6243AF", "#9270D5", "#BC9CE9", "#F49DAF", "#F2E77D"],
  },
  "i-rose": {
    ...options.b,
    colors: ["#4B1643", "#A3317D", "#D367A6", "#EB9AC1", "#4B78D1", "#FFD68A"],
  },
  "j-ice": {
    ...options.d,
    colors: ["#E5F3FF", "#B6DDF2", "#8BC5E5", "#A4D5E5", "#FF937C", "#9E75D4"],
    ink: "#213E68",
  },
  "k-cream": {
    ...options.e,
    colors: ["#FFF4CE", "#FFE4A3", "#F5CC7A", "#F3D493", "#ED6A56", "#69BFCB"],
    ink: "#57382C",
  },
  "l-sage": {
    ...options.f,
    colors: ["#F0F2D9", "#D4DFB8", "#AFCCAE", "#A0C4B4", "#F1A8AB", "#667FC4"],
  },
};
const variants = { ...options, ...accentOptions, ...moreAccentOptions };
const key = new URLSearchParams(location.search).get("palette");
const option =
  key && Object.hasOwn(variants, key)
    ? variants[key as keyof typeof variants]
    : moreAccentOptions["g-ocean"];
const colors = option.colors;
document.documentElement.style.setProperty("--ink", option.ink);
document.documentElement.style.setProperty("--shade", option.shade);
const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const palette = document.querySelector<HTMLDivElement>(".palette")!;
for (const color of colors) {
  const swatch = document.createElement("span");
  swatch.style.setProperty("--color", color);
  palette.appendChild(swatch);
}
// The same pigment renderer as the app, with a fixed seed for this artwork only.
const random = Math.random;
let atelier: Atelier;
try {
  Math.random = () => 0.42;
  atelier = new Atelier(canvas, { colors }, () => {
    throw new Error("WebGL2 is required to render the social card");
  });
} finally {
  Math.random = random;
}
atelier.resize(1200, 630);
await document.fonts.ready;
document.documentElement.dataset.ready = "true";
