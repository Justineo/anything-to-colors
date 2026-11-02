import { maxAudioBytes, maxTextLength } from "../shared/limits.ts";

const audioTypes = new Map([
  ["audio/webm", "webm"],
  ["audio/mp4", "mp4"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
]);

// Common single-period abbreviations across our Latin-script locales; dotted forms
// are already protected by the rule that only one period may occur in the text.
const abbreviation =
  /(?:^|[^\p{L}\p{M}\p{N}_])(?:mr|mrs|ms|mx|dr|dre|dra|prof|sr|sra|srta|jr|st|vs|etc|m|mm|mme|mmes|mlle|mlles|pr|me|hr|fr|bzw|usw|ca|ggf|nr|vgl|abb|str|ud|uds|núm|pág|av|ex|aprox)[.．]$/iu;

export function audioExtension(type: string) {
  return audioTypes.get(type.split(";")[0].trim().toLowerCase());
}

export async function readAudio(request: Request) {
  if (!audioExtension(request.headers.get("Content-Type") ?? ""))
    throw new Error("Unsupported audio format. Please type instead.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("No audio was received. Please try again.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxAudioBytes) {
        await reader.cancel();
        throw new Error("The recording is too large. Please try a shorter recording.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new Error("No audio was received. Please try again.");
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

export function transcriptionForm(audio: Uint8Array<ArrayBuffer>, type: string) {
  const form = new FormData();
  form.set("model", "gpt-transcribe");
  form.set("file", new Blob([audio], { type }), `voice.${audioExtension(type)}`);
  return form;
}

export function readTranscript(result: unknown) {
  if (
    !result ||
    typeof result !== "object" ||
    !("text" in result) ||
    typeof result.text !== "string"
  )
    return null;
  const text = result.text.trim();
  if (!text || text.length > maxTextLength) return null;
  if (!/[.。．]$/u.test(text) || abbreviation.test(text)) return text;

  const body = text.slice(0, -1).trimEnd();
  // Preserve sentence structure and ambiguous dots (numbers, addresses, ellipses).
  if (
    !/[\p{L}\p{N}]/u.test(body) ||
    /[.。．!?！？¡¿…\r\n\u0085\u2028\u2029]/u.test(body) ||
    /\p{N}$/u.test(body) ||
    /@|\b(?:https?|ftp):\/\//iu.test(body)
  )
    return text;
  return body;
}
