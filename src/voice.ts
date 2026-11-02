import { maxAudioBytes, maxRecordingMs } from "../shared/limits.ts";

export type VoiceState = "idle" | "permission" | "recording" | "sending";

export const cancelPadding = 80;

export function outsideRecordingArea(x: number, y: number, origin: { x: number; y: number }) {
  const radius = 28 + cancelPadding;
  return Math.abs(x - origin.x) > radius || Math.abs(y - origin.y) > radius;
}

function createRecorder(stream: MediaStream) {
  const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  return new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 64_000,
  });
}

type Session = {
  stream?: MediaStream;
  recorder?: MediaRecorder;
  timer?: ReturnType<typeof setTimeout>;
  released?: boolean;
};

// A cancelled permission request may still resolve later. Each continuation checks its
// session before starting a microphone or sending audio, including MediaRecorder's stop event.
export function holdRecorder(
  callbacks: {
    state: (state: VoiceState) => void;
    audio: (audio: Blob) => Promise<void>;
    error: (message: string) => void;
    limit: () => void;
    /** The live microphone, once granted, for anything that wants to follow the voice. */
    stream?: (stream: MediaStream) => void;
  },
  devices = {
    capture: () => navigator.mediaDevices.getUserMedia({ audio: true }),
    recorder: createRecorder,
  },
) {
  let session: Session | undefined;

  function stop(current: Session) {
    clearTimeout(current.timer);
    if (current.recorder && current.recorder.state !== "inactive") current.recorder.stop();
    current.stream?.getTracks().forEach((track) => track.stop());
  }

  function cancel() {
    const current = session;
    session = undefined;
    if (current) {
      stop(current);
      callbacks.state("idle");
    }
  }

  function fail(current: Session, message: string) {
    if (session !== current) return;
    cancel();
    callbacks.error(message);
  }

  function exceed(current: Session) {
    if (session !== current) return;
    cancel();
    callbacks.limit();
  }

  function release() {
    const current = session;
    if (!current) return;
    if (current.recorder?.state === "recording") {
      current.released = true;
      callbacks.state("sending");
      stop(current);
    } else if (!current.recorder) cancel();
  }

  async function start() {
    if (session) return;
    const current: Session = {};
    session = current;
    callbacks.state("permission");
    try {
      const stream = await devices.capture();
      current.stream = stream;
      if (session !== current) return stop(current);
      callbacks.stream?.(stream);
      const recorder = (current.recorder = devices.recorder(stream));
      const chunks: Blob[] = [];
      let size = 0;
      recorder.ondataavailable = (event) => {
        if (session !== current) return;
        size += event.data.size;
        if (size > maxAudioBytes) return exceed(current);
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () =>
        fail(current, "Recording was interrupted. Press and hold the background to try again.");
      recorder.onstop = async () => {
        if (session !== current) return;
        stop(current);
        if (!current.released)
          return fail(
            current,
            "Recording was interrupted. Press and hold the background to try again.",
          );
        const audio = new Blob(chunks, { type: recorder.mimeType });
        if (!audio.size)
          return fail(current, "No audio was recorded. Hold to speak, then release.");
        try {
          await callbacks.audio(audio);
        } catch (cause) {
          if (session === current)
            callbacks.error(
              cause instanceof Error
                ? cause.message
                : "Unable to send the recording. Please try again.",
            );
        } finally {
          if (session === current) {
            session = undefined;
            callbacks.state("idle");
          }
        }
      };
      recorder.start(250);
      callbacks.state("recording");
      current.timer = setTimeout(() => {
        if (recorder.state === "recording") exceed(current);
      }, maxRecordingMs);
    } catch (cause) {
      // A refusal is an answer, not an error: let it go quietly and ask again next time.
      if (cause instanceof DOMException && cause.name === "NotAllowedError") {
        if (session === current) cancel();
        return;
      }
      fail(current, "Microphone unavailable. Check your device or type instead.");
    }
  }

  return {
    start,
    cancel,
    release,
  };
}
