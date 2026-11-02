// Noto Serif at 380 has stems about four fifths of Geist Serif's (which has only 400), the balance
// at which mixed Chinese and Latin read as one weight while the Chinese stays light.
export const weight = 380;
export const leading = 1.4;

// What a reader sees as one character: an emoji family, a flag or a skin tone is a single
// grapheme even though it is several code points.
const segmenter =
  "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;
export const graphemes = (text: string) =>
  segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text);

// Use the browser's actual wrapping, including word boundaries, spacing and font features.
// Every measurement finishes before the painting receives the glyphs or the browser paints.
export function fit(element: HTMLElement, width: number, height: number) {
  let size = Math.max(20, Math.min(84, width * 0.1));
  element.style.fontSize = `${size}px`;
  while (element.offsetHeight > height * 0.5 && size > 18) {
    size = Math.max(18, size * 0.92);
    element.style.fontSize = `${size}px`;
  }
  return size;
}
