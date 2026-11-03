export type Palette = { colors: string[]; weights?: number[] };

const hex = /^#[0-9A-F]{6}$/;

export function readPalette(colors: unknown, weights?: unknown): Palette | null {
  if (
    !Array.isArray(colors) ||
    colors.length < 1 ||
    colors.length > 9 ||
    !colors.every((color) => typeof color === "string" && hex.test(color))
  )
    return null;

  if (
    !Array.isArray(weights) ||
    weights.length !== colors.length ||
    !weights.every((weight) => typeof weight === "number" && weight > 0 && weight <= 100)
  )
    return { colors };

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return { colors, weights: weights.map((weight) => weight / total) };
}
