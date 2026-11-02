// Keep readable GLSL in development; strip comments and redundant spacing for production.
// Preprocessor directives must stand on lines of their own, also once a compacted snippet that
// holds them is interpolated into the middle of another program.
export function compactGlsl(source: string) {
  return source
    .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ")
    .split(/(^[\t ]*#[^\n]*(?:\n|$))/m)
    .map((part) =>
      part.trimStart().startsWith("#")
        ? `\n${part.trim()}\n`
        : part.replace(/\s+/g, " ").replace(/\s*([{}()[\],;])\s*/g, "$1"),
    )
    .join("")
    .replace(/^\s*\n(?=#version)/, "");
}

// This module contains only GLSL template strings with simple ${name} interpolation.
// Preserve that sharing rather than expanding common shader functions into every program.
export function compactShaderModule(source: string) {
  return source.replace(/`([^`]*)`/g, (_, glsl: string) => `\`${compactGlsl(glsl)}\``);
}
