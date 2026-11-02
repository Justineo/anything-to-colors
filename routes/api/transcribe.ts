import { defineHandler } from "void";
import { env } from "void/env";
import { readAudio, readTranscript, transcriptionForm } from "../../server/transcription";
import { clientAccess, admissionResponse } from "../../server/access";
import { requestTiming } from "../../server/timing";
import { maxTextLength } from "../../shared/limits.ts";

export const POST = defineHandler(async (c) => {
  const began = performance.now();
  const headers = await clientAccess(c);
  const authorized = performance.now();
  if (headers instanceof Response) return headers;
  const type = c.req.header("Content-Type") ?? "";
  let audio;
  try {
    audio = await readAudio(c.req.raw);
  } catch (cause) {
    return c.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "Unable to read the recording. Please try again.",
      },
      400,
    );
  }
  try {
    const relay = env.COLOR_RELAY_URL;
    if (relay) headers.set("Content-Type", type);
    else headers.set("Authorization", `Bearer ${env.OPENAI_API_KEY}`);
    const response = await fetch(
      relay ? new URL("/api/transcribe", relay) : "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers,
        body: relay ? audio : transcriptionForm(audio, type),
        signal: AbortSignal.timeout(25_000),
      },
    );
    c.header("Server-Timing", requestTiming(response, began, authorized));
    const limited = admissionResponse(response);
    if (limited) return limited;
    if (!response.ok)
      return c.json({ error: "Transcription is unavailable. Record again or type instead." }, 502);
    const result = (await response.json()) as { text?: unknown } | null;
    if (typeof result?.text === "string" && result.text.trim().length > maxTextLength)
      return c.json(
        { error: "The transcript is too long. Please use fewer words.", code: "text_too_long" },
        422,
      );
    const text = readTranscript(result);
    if (!text)
      return c.json(
        { error: "No valid transcript was recognized. Please try a shorter recording." },
        422,
      );
    return c.json({ text });
  } catch {
    return c.json({ error: "Transcription timed out. Record again or type instead." }, 504);
  }
});
