"use client";

import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  FlaskConical,
  Mic,
  Plus,
  Server,
  Square,
} from "lucide-react";
import { api, mutation } from "@/lib/api";

export type LLMProfile = {
  id: string;
  name: string;
  provider: string;
  model: string;
  configured: boolean;
  editable: boolean;
  base_url?: string;
  key_ref?: string;
  json_mode?: string;
  token_parameter?: string;
  tokenizer?: string;
  temperature?: number | null;
  reasoning_effort?: string | null;
  input_price?: number | null;
  output_price?: number | null;
};
export type ProviderData = {
  selection: {
    llm_id: string;
    stt_id: string;
    version: number;
    updated_at: number;
  };
  llm_profiles: LLMProfile[];
  stt_sources: {
    id: string;
    name: string;
    model: string;
    language: string;
    configured: boolean;
  }[];
  key_refs: { id: string; configured: boolean }[];
  allowed_hosts: string[];
  demo_llm: boolean;
};
const panel = "rounded-2xl border border-white/10 bg-surface p-5 sm:p-6";
const field =
  "mt-2 w-full rounded-xl border border-white/10 bg-bg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet disabled:opacity-50";
const button =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40";
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Không thể xử lý cấu hình AI.";

function Configured({ value }: { value: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${value ? "bg-emerald-300/10 text-emerald-300" : "bg-amber-300/10 text-amber-300"}`}
    >
      {value && <Check className="size-3" />}
      {value ? "Đã cấu hình khóa" : "Chưa có khóa"}
    </span>
  );
}

export function ProviderPanel({
  data,
  onReload,
}: {
  data: ProviderData;
  onReload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<LLMProfile | "new" | null>(null);
  const [removing, setRemoving] = useState<LLMProfile | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (editing || removing) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [editing, removing]);
  async function saved() {
    setEditing(null);
    setRemoving(null);
    setError("");
    setNotice("Đã lưu cấu hình AI.");
    await onReload();
  }
  return (
    <div className="space-y-6" data-testid="provider-panel">
      <p className="max-w-3xl text-sm leading-6 text-fg-2">
        Chọn LLM và nhận dạng giọng nói độc lập. Cấu hình dùng chung cho toàn hệ
        thống; yêu cầu đang xử lý giữ nguyên nguồn đã chọn lúc bắt đầu.
      </p>
      {data.demo_llm && (
        <p
          role="status"
          className="rounded-xl bg-amber-300/10 p-4 text-sm text-amber-300"
        >
          Chat demo đang bật ở backend. Các nút thử bên dưới vẫn gọi dịch vụ
          thật và có thể phát sinh chi phí.
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl bg-emerald-300/10 p-4 text-sm text-emerald-300"
        >
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <SelectionForm key={data.selection.version} data={data} onSaved={saved} />
      <section className={panel}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <Server className="size-4 text-violet" />
            Cấu hình LLM
          </h2>
          <button className={button} onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            Thêm OpenAI-compatible
          </button>
        </div>
        <div className="space-y-3">
          {data.llm_profiles.map((profile) => (
            <article
              className="rounded-xl border border-white/5 bg-white/[0.02] p-4"
              key={profile.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words font-medium">
                    {profile.name}
                    {profile.id === data.selection.llm_id && (
                      <span className="ml-2 rounded-md bg-violet/10 px-2 py-1 text-xs text-violet">
                        Đang dùng
                      </span>
                    )}
                  </h3>
                  <p className="mt-2 break-all text-sm text-fg-3">
                    {profile.model}
                  </p>
                  {profile.base_url && (
                    <p className="mt-1 break-all text-xs text-fg-3">
                      {profile.base_url}
                    </p>
                  )}
                </div>
                <Configured value={profile.configured} />
              </div>
              {profile.editable && (
                <div className="mt-4 flex gap-2">
                  <button
                    className={button}
                    onClick={() => setEditing(profile)}
                    aria-label={`Sửa ${profile.name}`}
                  >
                    Chỉnh sửa
                  </button>
                  <button
                    className={button}
                    disabled={profile.id === data.selection.llm_id}
                    onClick={() => setRemoving(profile)}
                    aria-label={`Xóa ${profile.name}`}
                  >
                    Xóa
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
        <details className="mt-5 text-sm text-fg-3">
          <summary className="cursor-pointer">
            Khóa API và endpoint được phép
          </summary>
          <p className="mt-3 leading-6">
            Khóa API được quản lý ở backend/Secrets Manager. Giao diện chỉ dùng
            tên tham chiếu, không trả về giá trị khóa. Host được phép:{" "}
            <span className="break-all">
              {data.allowed_hosts.join(", ") || "Chưa cấu hình"}
            </span>
            .
          </p>
          <p className="mt-2">
            Cần thêm host hoặc khóa mới: cập nhật cấu hình backend rồi restart
            dịch vụ.
          </p>
        </details>
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <LLMProbe key={`llm:${data.selection.version}`} data={data} />
        <STTProbe key={`stt:${data.selection.version}`} data={data} />
      </div>
      <dialog
        ref={dialog}
        aria-labelledby="provider-editor-title"
        onCancel={() => {
          setEditing(null);
          setRemoving(null);
        }}
        onClose={() => {
          setEditing(null);
          setRemoving(null);
        }}
        className="m-auto max-h-[90dvh] w-[min(42rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border border-white/10 bg-surface p-6 text-fg backdrop:bg-black/70"
      >
        {editing && (
          <ProfileEditor
            key={`${editing === "new" ? "new" : editing.id}:${data.selection.version}`}
            profile={editing === "new" ? null : editing}
            data={data}
            onSaved={saved}
            onCancel={() => setEditing(null)}
          />
        )}
        {removing && (
          <DeleteForm
            data={data}
            profile={removing}
            onSaved={saved}
            onCancel={() => setRemoving(null)}
          />
        )}
      </dialog>
    </div>
  );
}

function SelectionForm({
  data,
  onSaved,
}: {
  data: ProviderData;
  onSaved: () => Promise<void>;
}) {
  const [llm, setLLM] = useState(data.selection.llm_id);
  const [stt, setSTT] = useState(data.selection.stt_id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className={`${panel} space-y-5`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          await api("/admin/providers", {
            method: "PATCH",
            body: JSON.stringify({
              llm_id: llm,
              stt_id: stt,
              version: data.selection.version,
              reason: String(form.get("reason")).trim(),
            }),
          });
          await onSaved();
        } catch (error) {
          setError(message(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="font-semibold">Nguồn đang hoạt động</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm">
          LLM đang dùng
          <select
            aria-label="LLM đang dùng"
            className={field}
            value={llm}
            onChange={(e) => setLLM(e.target.value)}
          >
            {data.llm_profiles.map((profile) => (
              <option
                key={profile.id}
                value={profile.id}
                disabled={
                  !profile.configured && profile.id !== data.selection.llm_id
                }
              >
                {profile.name} · {profile.model}
                {!profile.configured ? " · Chưa có khóa" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          STT đang dùng
          <select
            aria-label="STT đang dùng"
            className={field}
            value={stt}
            onChange={(e) => setSTT(e.target.value)}
          >
            {data.stt_sources.map((source) => (
              <option
                key={source.id}
                value={source.id}
                disabled={
                  !source.configured && source.id !== data.selection.stt_id
                }
              >
                {source.name} · Tiếng Việt
                {!source.configured ? " · Chưa có khóa" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm">
        Lý do đổi nguồn
        <textarea
          name="reason"
          className={field}
          rows={2}
          required
          minLength={3}
          maxLength={500}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <button
          className="btn-glow rounded-xl px-5 py-2.5 text-sm disabled:opacity-40"
          disabled={
            busy ||
            (llm === data.selection.llm_id && stt === data.selection.stt_id)
          }
        >
          {busy ? "Đang lưu…" : "Lưu nguồn AI"}
        </button>
        <p className="text-xs text-fg-3">
          Hệ thống dùng đúng nguồn đã chọn; không tự động chuyển nguồn khi lỗi.
        </p>
      </div>
    </form>
  );
}

function ProfileEditor({
  profile,
  data,
  onSaved,
  onCancel,
}: {
  profile: LLMProfile | null;
  data: ProviderData;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const form = new FormData(e.currentTarget);
        const number = (key: string) =>
          String(form.get(key) ?? "").trim() === ""
            ? null
            : Number(form.get(key));
        setBusy(true);
        setError("");
        const body = {
          name: form.get("name"),
          base_url: form.get("base_url"),
          model: form.get("model"),
          key_ref: form.get("key_ref"),
          json_mode: form.get("json_mode"),
          token_parameter: form.get("token_parameter"),
          tokenizer: form.get("tokenizer"),
          temperature: number("temperature"),
          reasoning_effort: form.get("reasoning_effort") || null,
          input_price: number("input_price"),
          output_price: number("output_price"),
          reason: form.get("reason"),
          version: data.selection.version,
        };
        try {
          await api(
            profile
              ? `/admin/providers/llm/${profile.id}`
              : "/admin/providers/llm",
            { method: profile ? "PUT" : "POST", body: JSON.stringify(body) },
          );
          await onSaved();
        } catch (error) {
          setError(message(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 id="provider-editor-title" className="text-lg font-semibold">
        {profile ? "Sửa cấu hình LLM" : "Thêm OpenAI-compatible"}
      </h2>
      <label className="block text-sm">
        Tên hiển thị
        <input
          name="name"
          className={field}
          required
          minLength={2}
          maxLength={80}
          defaultValue={profile?.name}
          placeholder="OpenAI / OpenRouter / LLM riêng"
        />
      </label>
      <label className="block text-sm">
        Base URL
        <input
          name="base_url"
          type="url"
          className={field}
          required
          maxLength={500}
          defaultValue={profile?.base_url}
          placeholder="https://api.openai.com/v1"
        />
        <span className="mt-2 block text-xs text-fg-3">
          Địa chỉ gốc của API; hệ thống sẽ nối thêm /chat/completions. Host phải
          nằm trong danh sách backend cho phép.
        </span>
      </label>
      <label className="block text-sm">
        Model
        <input
          name="model"
          className={field}
          required
          maxLength={160}
          defaultValue={profile?.model}
          placeholder="gpt-4o-mini"
        />
      </label>
      <label className="block text-sm">
        Tên khóa API
        <select
          name="key_ref"
          aria-label="Tên khóa API"
          className={field}
          defaultValue={
            profile?.key_ref ??
            data.key_refs.find((key) => key.configured)?.id ??
            "groq"
          }
        >
          {data.key_refs.map((key) => (
            <option key={key.id} value={key.id}>
              {key.id}
              {key.configured ? "" : " · Chưa có khóa"}
            </option>
          ))}
        </select>
      </label>
      <details
        open={!!profile}
        className="rounded-xl border border-white/10 p-4"
      >
        <summary className="cursor-pointer text-sm">
          Khả năng model & giá tham chiếu
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            Định dạng JSON
            <select
              name="json_mode"
              aria-label="Định dạng JSON"
              className={field}
              defaultValue={profile?.json_mode ?? "json_object"}
            >
              <option value="json_object">JSON mode</option>
              <option value="json_schema">
                Structured output (JSON Schema)
              </option>
              <option value="prompt">Theo hướng dẫn trong prompt</option>
            </select>
          </label>
          <label className="text-sm">
            Tham số giới hạn đầu ra
            <select
              name="token_parameter"
              aria-label="Tham số giới hạn đầu ra"
              className={field}
              defaultValue={profile?.token_parameter ?? "max_tokens"}
            >
              <option value="max_tokens">max_tokens</option>
              <option value="max_completion_tokens">
                max_completion_tokens
              </option>
            </select>
          </label>
          <label className="text-sm">
            Bộ đếm token
            <select
              name="tokenizer"
              aria-label="Bộ đếm token"
              className={field}
              defaultValue={profile?.tokenizer ?? "o200k_base"}
            >
              <option value="o200k_base">
                OpenAI o200k (GPT-4o, o-series)
              </option>
              <option value="cl100k_base">
                OpenAI cl100k (GPT-4, GPT-3.5)
              </option>
              <option value="qwen">Qwen</option>
              <option value="utf8">Ước lượng bảo thủ UTF-8</option>
            </select>
          </label>
          <label className="text-sm">
            Reasoning effort
            <select
              name="reasoning_effort"
              aria-label="Reasoning effort"
              className={field}
              defaultValue={profile?.reasoning_effort ?? ""}
            >
              <option value="">Dùng mặc định của model</option>
              {["none", "minimal", "low", "medium", "high"].map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Temperature
            <input
              name="temperature"
              type="number"
              min={0}
              max={2}
              step="any"
              className={field}
              defaultValue={profile?.temperature ?? ""}
              placeholder="Để trống: không gửi tham số"
            />
          </label>
          <label className="text-sm">
            USD / 1M token đầu vào
            <input
              name="input_price"
              type="number"
              min={0}
              max={10000}
              step="any"
              className={field}
              defaultValue={profile?.input_price ?? ""}
            />
          </label>
          <label className="text-sm">
            USD / 1M token đầu ra
            <input
              name="output_price"
              type="number"
              min={0}
              max={10000}
              step="any"
              className={field}
              defaultValue={profile?.output_price ?? ""}
            />
          </label>
        </div>
        <p className="mt-4 text-xs leading-5 text-fg-3">
          Chọn theo khả năng model. Mọi câu trả lời vẫn được kiểm tra cấu trúc
          lời dẫn/lời thoại trước khi dùng. Để trống cả hai mức giá nếu chưa
          biết; hệ thống sẽ hiển thị số yêu cầu chưa định giá.
        </p>
      </details>
      <label className="block text-sm">
        Lý do lưu cấu hình
        <textarea
          name="reason"
          className={field}
          rows={2}
          required
          minLength={3}
          maxLength={500}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button className={button} disabled={busy}>
          {busy ? "Đang lưu…" : "Lưu cấu hình LLM"}
        </button>
        <button
          className={button}
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Hủy
        </button>
      </div>
    </form>
  );
}

function DeleteForm({
  data,
  profile,
  onSaved,
  onCancel,
}: {
  data: ProviderData;
  profile: LLMProfile;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const reason = String(new FormData(e.currentTarget).get("reason"));
        setBusy(true);
        try {
          await api(`/admin/providers/llm/${profile.id}`, {
            method: "DELETE",
            body: JSON.stringify({ version: data.selection.version, reason }),
          });
          await onSaved();
        } catch (error) {
          setError(message(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 id="provider-editor-title" className="text-lg font-semibold">
        Xóa {profile.name}
      </h2>
      <p className="text-sm text-fg-3">
        Lịch sử sử dụng của nguồn này vẫn được giữ lại.
      </p>
      <label className="block text-sm">
        Lý do xóa
        <textarea
          name="reason"
          className={field}
          required
          minLength={3}
          maxLength={500}
          rows={2}
        />
      </label>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button disabled={busy} className={button}>
          Xác nhận xóa
        </button>
        <button
          disabled={busy}
          type="button"
          className={button}
          onClick={onCancel}
        >
          Hủy
        </button>
      </div>
    </form>
  );
}

function LLMProbe({ data }: { data: ProviderData }) {
  const [ident, setIdent] = useState(data.selection.llm_id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    model: string;
    elapsed_ms: number;
    segments: { type: string; text: string }[];
  }>();
  return (
    <form
      className={`${panel} space-y-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const text = String(new FormData(e.currentTarget).get("text"));
        setBusy(true);
        setError("");
        setResult(undefined);
        try {
          setResult(
            await api(
              `/admin/providers/llm/${ident}/test`,
              mutation({ text, version: data.selection.version }),
            ),
          );
        } catch (error) {
          setError(message(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="flex items-center gap-2 font-semibold">
        <FlaskConical className="size-4 text-violet" />
        Thử phản hồi LLM
      </h2>
      <p className="text-xs leading-5 text-fg-3">
        Dùng nhân vật Kaito Kid và system prompt đang xuất bản. Thử không đổi
        nguồn đang hoạt động; dịch vụ có thể tính phí.
      </p>
      <label className="block text-sm">
        Nguồn LLM để thử
        <select
          aria-label="Nguồn LLM để thử"
          disabled={busy}
          className={field}
          value={ident}
          onChange={(e) => {
            setIdent(e.target.value);
            setResult(undefined);
            setError("");
          }}
        >
          {data.llm_profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} · {profile.model}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Tin nhắn thử
        <textarea
          name="text"
          className={field}
          required
          minLength={1}
          maxLength={1000}
          rows={3}
          defaultValue="Chào bạn, hãy giới thiệu ngắn về bản thân."
        />
      </label>
      <button
        className={button}
        disabled={
          busy ||
          !data.llm_profiles.find((profile) => profile.id === ident)?.configured
        }
      >
        {busy ? "Đang thử…" : "Thử phản hồi"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="space-y-3 rounded-xl bg-white/5 p-4">
          <p className="text-xs text-emerald-300">
            Đã nhận phản hồi hợp lệ · {result.elapsed_ms} ms · {result.model}
          </p>
          {result.segments.map((segment, i) => (
            <p
              key={i}
              className={`whitespace-pre-wrap break-words text-sm leading-6 ${segment.type === "narration" ? "italic text-fg-3" : ""}`}
            >
              {segment.text}
            </p>
          ))}
        </div>
      )}
    </form>
  );
}

function STTProbe({ data }: { data: ProviderData }) {
  const [ident, setIdent] = useState(data.selection.stt_id);
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    text: string;
    elapsed_ms: number;
    model: string;
  }>();
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);
  const acquiring = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state !== "inactive") recorder.current.stop();
      }
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  async function record() {
    if (acquiring.current || recording) return;
    acquiring.current = true;
    setError("");
    setResult(undefined);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!live.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const rec = new MediaRecorder(
        media,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      rec.onstop = () => {
        if (timer.current) clearTimeout(timer.current);
        media.getTracks().forEach((track) => track.stop());
        recorder.current = null;
        stream.current = null;
        if (live.current) {
          const type = rec.mimeType || mime || "audio/webm";
          setFile(
            new File(
              chunks,
              type.includes("mp4")
                ? "probe.m4a"
                : type.includes("ogg")
                  ? "probe.ogg"
                  : "probe.webm",
              { type },
            ),
          );
          setRecording(false);
        }
      };
      rec.onerror = () => {
        media.getTracks().forEach((track) => track.stop());
        if (live.current) {
          setError("Không thể ghi âm. Hãy thử lại hoặc tải tệp audio.");
          setRecording(false);
        }
      };
      rec.start();
      setRecording(true);
      setFile(null);
      timer.current = setTimeout(() => {
        if (rec.state !== "inactive") rec.stop();
      }, 29000);
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (live.current)
        setError(
          "Không thể mở microphone. Kiểm tra quyền truy cập hoặc tải tệp audio.",
        );
    } finally {
      acquiring.current = false;
    }
  }
  return (
    <form
      className={`${panel} space-y-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file || busy || recording) return;
        const form = new FormData();
        form.append("file", file);
        form.append("version", String(data.selection.version));
        setBusy(true);
        setError("");
        setResult(undefined);
        try {
          setResult(
            await api(`/admin/providers/stt/${ident}/test`, {
              method: "POST",
              body: form,
            }),
          );
        } catch (error) {
          setError(message(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="flex items-center gap-2 font-semibold">
        <AudioLines className="size-4 text-sky-300" />
        Thử nhận dạng giọng nói
      </h2>
      <p className="text-xs leading-5 text-fg-3">
        Tiếng Việt · tối đa 30 giây / 5 MB. Thử không đổi nguồn đang hoạt động;
        dịch vụ có thể tính phí.
      </p>
      <label className="block text-sm">
        Nguồn STT để thử
        <select
          aria-label="Nguồn STT để thử"
          className={field}
          value={ident}
          disabled={recording || busy}
          onChange={(e) => {
            setIdent(e.target.value);
            setResult(undefined);
            setError("");
          }}
        >
          {data.stt_sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Tệp audio
        <input
          type="file"
          accept="audio/*,video/webm"
          className={field}
          disabled={recording || busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(undefined);
          }}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        {recording ? (
          <button
            type="button"
            className={button}
            onClick={() => {
              if (recorder.current?.state !== "inactive")
                recorder.current?.stop();
            }}
          >
            <Square className="size-4 text-danger" />
            Dừng ghi âm
          </button>
        ) : (
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => void record()}
          >
            <Mic className="size-4" />
            Ghi âm thử
          </button>
        )}
        {file && (
          <span className="min-w-0 break-all text-xs text-fg-3">
            {file.name}
          </span>
        )}
      </div>
      <button
        className={button}
        disabled={
          busy ||
          recording ||
          !file ||
          !data.stt_sources.find((source) => source.id === ident)?.configured
        }
      >
        {busy ? "Đang nhận dạng…" : "Thử nhận dạng"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="rounded-xl bg-white/5 p-4">
          <p className="mb-3 text-xs text-emerald-300">
            Đã nhận transcript · {result.elapsed_ms} ms · {result.model}
          </p>
          <p className="whitespace-pre-wrap break-words text-sm leading-6">
            {result.text}
          </p>
        </div>
      )}
    </form>
  );
}
