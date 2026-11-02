// Keep the invitation in one tiny request. Group the remaining built-in glyphs
// in reading order so nearby captions tend to share small, reusable font files.
export function fontSubsets(invite: string, captions: string[]) {
  const points = (text: string) =>
    [...new Set(Array.from(text, (char) => char.codePointAt(0)!))].filter(
      (point) => point > 0x024f,
    );
  const critical = points(invite + "国…");
  const seen = new Set(critical);
  const remaining = points(captions.join("")).filter((point) => !seen.has(point));
  const subsets = [critical];
  for (let index = 0; index < remaining.length; index += 32)
    subsets.push(remaining.slice(index, index + 32));
  return subsets;
}

// Full-font coverage must not overlap the small UI fonts. Loading an uncommon
// character can then never replace already-loaded UI glyphs with larger files.
export function excludeGlyphs(value: string, excluded: Set<number>) {
  const points = [...excluded].sort((a, b) => a - b);
  const ranges: number[][] = [];
  for (const range of value.split(",")) {
    const [start, end = start] = range.trim().slice(2).split("-");
    const last = parseInt(end, 16);
    let next = parseInt(start, 16);
    for (const point of points) {
      if (point < next) continue;
      if (point > last) break;
      if (next < point) ranges.push([next, point - 1]);
      next = point + 1;
    }
    if (next <= last) ranges.push([next, last]);
  }
  return ranges
    .map(([start, end]) => `U+${start.toString(16)}${start === end ? "" : `-${end.toString(16)}`}`)
    .join(",");
}
