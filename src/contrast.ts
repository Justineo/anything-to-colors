import { APCAcontrast, sRGBtoY } from "apca-w3";

const black = sRGBtoY([0, 0, 0]);
const white = sRGBtoY([255, 255, 255]);

export function foreground(background: string) {
  // Inputs are always six-digit hex; skip the dependency's general CSS color parser.
  const rgb = [1, 3, 5].map((start) => parseInt(background.slice(start, start + 2), 16));
  const luminance = sRGBtoY(rgb as [number, number, number]);
  return Math.abs(APCAcontrast(black, luminance) as number) >=
    Math.abs(APCAcontrast(white, luminance) as number)
    ? "#000000"
    : "#ffffff";
}
