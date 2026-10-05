import { api, ApiError, mutation, requestId } from "../api";
export type Voice = { id: string; name: string };
export class DialoguePlayer {
  private context: AudioContext | null = null;
  private controller: AbortController | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private job: string | null = null;
  private epoch = 0;
  /** Call from a click so later playback can start after speech recognition. */
  unlock() {
    if (!this.context || this.context.state === "closed")
      this.context = new AudioContext({ sampleRate: 24000 });
    void this.context.resume();
    const buffer = this.context.createBuffer(1, 1, 24000);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.start();
  }
  stop() {
    this.epoch++;
    this.controller?.abort();
    this.controller = null;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    if (this.job)
      void api(`/speech/jobs/${this.job}/cancel`, mutation()).catch(() => {});
    this.job = null;
  }
  async play(messageId: string, voiceId?: string) {
    this.stop();
    const epoch = this.epoch;
    const ctrl = new AbortController();
    this.controller = ctrl;
    if (!this.context || this.context.state === "closed")
      this.context = new AudioContext({ sampleRate: 24000 });
    const context = this.context;
    await context.resume();
    const job = await api<{ id: string }>(`/messages/${messageId}/tts`, {
      ...mutation(voiceId ? { voice_id: voiceId } : {}, requestId()),
      signal: ctrl.signal,
    });
    if (epoch !== this.epoch) {
      void api(`/speech/jobs/${job.id}/cancel`, mutation()).catch(() => {});
      return;
    }
    this.job = job.id;
    const res = await fetch(`/api/v1/speech/jobs/${job.id}/stream`, {
      headers: { "X-Lumi-Request": "1" },
      signal: ctrl.signal,
      credentials: "same-origin",
    });
    if (!res.ok || !res.body) {
      const error = await res.json().catch(() => ({}));
      throw new ApiError(
        error.message || "Không thể phát giọng đọc.",
        error.code || "AUDIO_FAILED",
        res.status,
      );
    }
    const reader = res.body.getReader();
    let carry = new Uint8Array(0);
    let when = context.currentTime + 0.12;
    let bytes = 0;
    try {
      while (epoch === this.epoch) {
        // Keep buffering bounded even when a cached response downloads much faster than playback.
        while (when - context.currentTime > 2 && !ctrl.signal.aborted)
          await new Promise((r) => setTimeout(r, 50));
        if (ctrl.signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        const all = new Uint8Array(carry.length + value.length);
        all.set(carry);
        all.set(value, carry.length);
        const length = all.length - (all.length % 2);
        carry = all.slice(length);
        if (!length) continue;
        bytes += length;
        const buffer = context.createBuffer(1, length / 2, 24000);
        const samples = buffer.getChannelData(0);
        const view = new DataView(all.buffer, all.byteOffset, length);
        for (let i = 0; i < samples.length; i++)
          samples[i] = view.getInt16(i * 2, true) / 32768;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        this.sources.push(source);
        when = Math.max(when, context.currentTime + 0.03);
        source.start(when);
        when += buffer.duration;
      }
      if (ctrl.signal.aborted || epoch !== this.epoch) return;
      if (!bytes || carry.length)
        throw new Error("Giọng đọc chưa hoàn chỉnh. Hãy thử lại.");
      while (
        epoch === this.epoch &&
        !ctrl.signal.aborted &&
        context.currentTime < when
      )
        await new Promise((r) => setTimeout(r, 80));
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      if (epoch === this.epoch) this.stop();
    }
  }
}
const SPEECH_RMS = 0.02;
const SILENCE_MS = 800;
const MIN_SPEECH_MS = 280;
const NO_SPEECH_MS = 12000;

function level(analyser: AnalyserNode, samples: Uint8Array<ArrayBuffer>) {
  analyser.getByteTimeDomainData(samples);
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = (samples[i] - 128) / 128;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

/** Record until the speaker pauses. Returns null when nobody spoke. */
export async function captureUtterance(
  stream: MediaStream,
  options: { signal: AbortSignal; maxMs: number },
) {
  if (typeof MediaRecorder === "undefined")
    throw new Error("Trình duyệt chưa hỗ trợ ghi âm.");
  const mime = [
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ].find((type) => MediaRecorder.isTypeSupported(type));
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => {
    rec.addEventListener("stop", () => resolve(), { once: true });
  });
  const halt = () => {
    if (rec.state !== "inactive") rec.stop();
  };
  options.signal.addEventListener("abort", halt, { once: true });
  rec.start();
  const started = performance.now();
  let speechAt: number | null = null;
  let lastVoice = 0;
  let speechMs = 0;
  try {
    while (!options.signal.aborted && rec.state === "recording") {
      const now = performance.now();
      if (level(analyser, samples) >= SPEECH_RMS) {
        speechAt ??= now;
        lastVoice = now;
        speechMs += 50;
      }
      if (now - started >= options.maxMs) break;
      if (
        speechAt !== null &&
        speechMs >= MIN_SPEECH_MS &&
        now - lastVoice >= SILENCE_MS
      )
        break;
      if (speechAt === null && now - started >= NO_SPEECH_MS) {
        halt();
        await stopped;
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    source.disconnect();
    await context.close().catch(() => {});
    options.signal.removeEventListener("abort", halt);
  }
  if (rec.state !== "inactive") rec.stop();
  await stopped;
  if (options.signal.aborted || speechMs < MIN_SPEECH_MS) return null;
  return new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
}

export async function transcript(
  blob: Blob,
  filename: string,
  signal?: AbortSignal,
) {
  const form = new FormData();
  form.append("file", blob, filename);
  return api<{ text: string }>("/speech/transcriptions", {
    method: "POST",
    body: form,
    signal,
    headers: { "Idempotency-Key": requestId() },
  });
}
