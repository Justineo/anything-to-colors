const loaders = {
  zh: () => import("./locales/zh.json", { with: { type: "json" } }),
  en: () => import("./locales/en.json", { with: { type: "json" } }),
  ja: () => import("./locales/ja.json", { with: { type: "json" } }),
  ko: () => import("./locales/ko.json", { with: { type: "json" } }),
  fr: () => import("./locales/fr.json", { with: { type: "json" } }),
  de: () => import("./locales/de.json", { with: { type: "json" } }),
  es: () => import("./locales/es.json", { with: { type: "json" } }),
  pt: () => import("./locales/pt.json", { with: { type: "json" } }),
};

export type Locale = keyof typeof loaders;
type Translation = typeof import("./locales/en.json");
type Messages = Omit<Translation, "presets" | "copy" | "copied" | "palette" | "paletteOne"> & {
  copy: (color: string) => string;
  copied: (color: string) => string;
  palette: (text: string, count: number) => string;
};

export function resolveLocale(languages: readonly string[], override?: string | null): Locale {
  for (const language of override ? [override, ...languages] : languages) {
    const base = language.trim().toLowerCase().split(/[-_]/)[0];
    if (Object.hasOwn(loaders, base)) return base as Locale;
  }
  return "en";
}

export async function loadLocale(languages: readonly string[], override?: string | null) {
  const selected = resolveLocale(languages, override);
  try {
    return { locale: selected, data: (await loaders[selected]()).default };
  } catch (cause) {
    if (selected === "en") throw cause;
    return { locale: "en" as const, data: (await loaders.en()).default };
  }
}

// Initialized before the app mounts; only the chosen language is downloaded.
export let locale: Locale;
export let messagesForLocale: Messages;
export let presetCaptions: string[];

function format(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(color|text|count)\}/g, (_, key: string) => String(values[key]));
}

export async function initializeLocale(
  languages = navigator.languages?.length ? navigator.languages : [navigator.language],
  override?: string | null,
) {
  const selected = await loadLocale(languages, override);
  locale = selected.locale;
  const { presets, ...messages } = selected.data;
  presetCaptions = presets;
  messagesForLocale = {
    ...messages,
    copy: (color) => format(messages.copy, { color }),
    copied: (color) => format(messages.copied, { color }),
    palette: (text, count) =>
      format(count === 1 ? messages.paletteOne : messages.palette, { text, count }),
  };
}
