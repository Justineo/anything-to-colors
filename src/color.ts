export type Lab = [number, number, number];

/** The start and end of each blend, with room for even a narrow accent to reach its full color. */
export function paletteEdges(count: number, weights?: number[]) {
  const edges = new Float32Array(16).fill(2);
  let boundary = 0;
  for (let i = 0; i < count - 1; i++) {
    boundary = weights ? boundary + weights[i] : (i + 0.5) / (count - 1);
    const half = 0.42 * (weights ? Math.min(weights[i], weights[i + 1]) : 1 / (count - 1));
    edges.set([boundary - half, boundary + half], i * 2);
  }
  return edges;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToRgb(hex: string): Lab {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255) as Lab;
}

export function hexToOklab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// Averages light, not hex digits, so the result is what the eye integrates.
export function meanColor(colors: string[], weights?: number[]) {
  const sum = [0, 0, 0];
  colors.forEach((color, index) => {
    const share = weights?.[index] ?? 1 / colors.length;
    hexToRgb(color).forEach((channel, i) => (sum[i] += toLinear(channel) * share));
  });
  return (
    "#" +
    sum
      .map((channel) =>
        Math.round(Math.min(1, Math.max(0, toGamma(channel))) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
