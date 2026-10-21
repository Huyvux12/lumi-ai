import test from "node:test";
import assert from "node:assert/strict";
import { load, loadFunction } from "./helpers.mjs";

test("preview sends preceding turns and excludes the current turn from history", async () => {
  let body;
  const { streamReply } = load("src/lib/chat/client.ts", { modules: {
    "@/lib/auth": { currentUser: () => null },
    "@/lib/api": { requestId: () => "test-request", mutation: (data) => ({ body: JSON.stringify(data) }),
      api: async (_, init) => { body = JSON.parse(init.body); return { content: "Reply", mode: "demo" }; } },
  } });
  const first = { role: "user", content: "My name is AuditName" };
  const reply = { role: "assistant", content: "Hello AuditName" };
  const character = {
    name: "Test", tagline: "A test tagline", description: "A long test description", persona: "A long test persona",
    greeting: "Hello there!", tags: [], hue: 265, seed: "test", scenario: "A storm",
  };
  await streamReply({ characterId: "test", character, messages: [first, reply, { role: "user", content: "What is my name?" }, { role: "assistant", content: "" }] }, () => {});
  assert.equal(body.text, "What is my name?");
  assert.deepEqual(body.history, [first, reply]);
  assert.equal(body.character.scenario, "A storm");
  const older = Array.from({ length: 12 }, (_, i) => ({
    role: i % 2 ? "assistant" : "user", content: "A".repeat(i % 2 ? 6000 : 3000),
  }));
  await streamReply({ characterId: "test", character, messages: [...older, { role: "user", content: "Continue" }] }, () => {});
  assert.ok(body.history.reduce((total, message) => total + message.content.length, 0) <= 32000);
  assert.deepEqual(body.history.at(-1), older.at(-1));
});

for (const failure of ["transcription", "chat"]) {
  test(`voice call releases the microphone after ${failure} failure`, async () => {
    const epoch = { current: 1 };
    let recordings = 0, ended = 0;
    const run = loadFunction("src/components/ChatView.tsx", "runCall", {
      user: { plan: "free" }, recordingSeconds: () => 60, callEpoch: epoch, callAbort: { current: null },
      setCallMode() {}, setError() {},
      endCall() { ended++; epoch.current++; },
      captureUtterance: async () => {
        if (++recordings > 2) throw new Error("Unexpected microphone retry");
        return { type: "audio/webm" };
      },
      transcript: async (_, __, signal) => {
        assert.ok(signal);
        if (failure === "transcription") throw new Error("503 PROVIDER_UNAVAILABLE");
        return { text: "Xin chào" };
      },
      sendRef: { current: async () => null }, listenRef: { current: async () => {} },
    });
    await run(1, {});
    assert.equal(recordings, 1);
    assert.equal(ended, 1);
  });
}

test("voice call retries empty speech but ends on the subsequent provider failure", async () => {
  const epoch = { current: 1 };
  let recordings = 0, ended = 0;
  const run = loadFunction("src/components/ChatView.tsx", "runCall", {
    user: { plan: "free" }, recordingSeconds: () => 60, callEpoch: epoch, callAbort: { current: null }, setCallMode() {}, setError() {},
    endCall() { ended++; epoch.current++; },
    captureUtterance: async () => { recordings++; return { type: "audio/webm" }; },
    transcript: async () => { throw new Error(recordings === 1 ? "Chưa nhận được lời nói" : "503 PROVIDER_UNAVAILABLE"); },
    sendRef: { current: async () => null }, listenRef: { current: async () => {} },
  });
  await run(1, {});
  assert.equal(recordings, 2);
  assert.equal(ended, 1);
});

class AudioContextMock {
  state = "running";
  clock = 0;
  destination = {};
  get currentTime() { this.clock += 10; return this.clock; }
  async resume() {}
  createBuffer(_, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
  createBufferSource() { return { connect() {}, start() {}, stop() {} }; }
}

test("completed PCM playback does not send a cancellation request", async () => {
  const requests = [];
  let reads = 0;
  const { DialoguePlayer } = load("src/lib/chat/speech.ts", {
    modules: { "../api": { api: async (path) => { requests.push(path); return { id: "test-job" }; },
      mutation: () => ({}), requestId: () => "test-request" } },
    globals: { AudioContext: AudioContextMock, fetch: async () => ({ ok: true, body: { getReader: () => ({
      read: async () => ++reads === 1 ? { done: false, value: new Uint8Array([1, 0, 1, 0]) } : { done: true },
      cancel: async () => {}, releaseLock() {},
    }) } }) },
  });
  await new DialoguePlayer().play("message");
  assert.deepEqual(requests, ["/messages/message/tts"]);
});

test("explicit stop cancels a pending audio job exactly once", async () => {
  const requests = [];
  let completeRead, startedRead;
  const reading = new Promise((resolve) => { startedRead = resolve; });
  const { DialoguePlayer } = load("src/lib/chat/speech.ts", {
    modules: { "../api": { api: async (path) => { requests.push(path); return { id: "test-job" }; },
      mutation: () => ({}), requestId: () => "test-request" } },
    globals: { AudioContext: AudioContextMock, fetch: async () => ({ ok: true, body: { getReader: () => ({
      read: () => new Promise((resolve) => { completeRead = resolve; startedRead(); }),
      cancel: async () => {}, releaseLock() {},
    }) } }) },
  });
  const player = new DialoguePlayer();
  const playback = player.play("message");
  await reading;
  player.stop();
  completeRead({ done: true });
  await playback;
  assert.deepEqual(requests, ["/messages/message/tts", "/speech/jobs/test-job/cancel"]);
});
