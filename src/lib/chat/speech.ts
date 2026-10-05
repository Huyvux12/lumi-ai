import { api, ApiError, mutation, requestId } from "../api";
export type Voice = { id: string; name: string };
export class DialoguePlayer {
  private context: AudioContext | null = null;
  private controller: AbortController | null = null;
  private job: string | null = null;
  private epoch = 0;
  stop() {
    this.epoch++;
    this.controller?.abort();
    this.controller = null;
    void this.context?.close().catch(() => {});
    this.context = null;
    if (this.job)
      void api(`/speech/jobs/${this.job}/cancel`, mutation()).catch(() => {});
    this.job = null;
  }
  async play(messageId: string, voiceId?: string) {
    this.stop();
    const epoch = this.epoch;
    const ctrl = new AbortController();
    this.controller = ctrl;
    // Resume synchronously within the click gesture (required on mobile browsers).
    const context = new AudioContext({ sampleRate: 24000 });
    this.context = context;
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
        when = Math.max(when, context.currentTime + 0.03);
        source.start(when);
        when += buffer.duration;
      }
      if (!bytes || carry.length)
        throw new Error("Giọng đọc chưa hoàn chỉnh. Hãy thử lại.");
      while (epoch === this.epoch && context.currentTime < when)
        await new Promise((r) => setTimeout(r, 80));
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      if (epoch === this.epoch) this.stop();
    }
  }
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
