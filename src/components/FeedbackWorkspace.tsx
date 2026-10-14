"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { api, mutation } from "@/lib/api";
import {
  feedbackDate,
  feedbackKinds,
  feedbackPriorities,
  feedbackStatuses,
  safeFeedbackPath,
  type Assignee,
  type Feedback,
  type FeedbackKind,
  type FeedbackList,
  type FeedbackStatus,
  type FeedbackThread,
} from "@/lib/feedback";

const field =
  "w-full rounded-xl border border-white/10 bg-bg px-3 py-2.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent";
const button =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50";
const panel = "rounded-2xl border border-white/10 bg-surface p-5 sm:p-6";
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Không thể xử lý. Vui lòng thử lại.";

function useRemote<T>(url: string | null, refresh: number) {
  const key = `${url}:${refresh}`;
  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error?: string;
  }>();
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    api<T>(url, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ key, error: errorText(error) });
      });
    return () => controller.abort();
  }, [url, key]);
  return {
    data: result?.key === key ? result.data : undefined,
    error: result?.key === key ? result.error : undefined,
    pending: !!url && result?.key !== key,
  };
}

export function FeedbackBadge({ status }: { status: FeedbackStatus }) {
  return (
    <span
      className={`inline-flex rounded-lg px-2.5 py-1 text-xs ${status === "resolved" ? "bg-emerald-300/10 text-emerald-300" : status === "closed" ? "bg-white/5 text-fg-3" : "bg-violet/15 text-violet"}`}
    >
      {feedbackStatuses[status]}
    </span>
  );
}

export function FeedbackWorkspace({
  admin = false,
  refreshKey = 0,
  onChanged,
}: {
  admin?: boolean;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ident = params.get("feedback");
  const compose = !admin && params.get("compose") === "1";
  const status = params.get("status") ?? "";
  const kind = params.get("kind") ?? "";
  const validStatus = Object.hasOwn(feedbackStatuses, status) ? status : "";
  const validKind = Object.hasOwn(feedbackKinds, kind) ? kind : "";
  const page = Math.min(
    50000,
    Math.max(1, Math.floor(Number(params.get("page")) || 1)),
  );
  const messagePage = Math.min(
    50000,
    Math.max(0, Math.floor(Number(params.get("message_page")) || 0)),
  );
  const q = (params.get("q") ?? "").slice(0, 120);
  const prefix = admin ? "/admin/feedback" : "/feedback";
  const [refresh, setRefresh] = useState(0);
  const query = new URLSearchParams({ page: String(page) });
  if (validStatus) query.set("status", validStatus);
  if (validKind) query.set("kind", validKind);
  if (admin && q) query.set("q", q);
  const list = useRemote<FeedbackList>(
    !ident && !compose ? `${prefix}?${query}` : null,
    refresh + refreshKey,
  );
  const thread = useRemote<FeedbackThread>(
    ident
      ? `${prefix}/${encodeURIComponent(ident)}?message_page=${messagePage}`
      : null,
    refresh + refreshKey,
  );
  const assignees = useRemote<Assignee[]>(
    admin && ident ? "/admin/feedback-assignees" : null,
    refreshKey,
  );
  const seen = useRef<string>("");
  useEffect(() => {
    const data = thread.data;
    if (admin || !data || data.message_page !== data.message_pages) return;
    const key = `${data.feedback.id}:${data.feedback.public_updated_at}`;
    if (seen.current === key) return;
    seen.current = key;
    api(`/feedback/${data.feedback.id}/read`, {
      ...mutation({ seen_at: data.feedback.public_updated_at }),
    }).catch(() => {
      if (seen.current === key) seen.current = "";
    });
  }, [admin, thread.data]);
  function navigate(values: Record<string, string | null>, replace = false) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    const href = `${pathname}?${next}`;
    if (replace) router.replace(href, { scroll: false });
    else router.push(href);
  }
  function changed() {
    setRefresh((value) => value + 1);
    onChanged?.();
  }
  const back = () =>
    navigate({ feedback: null, compose: null, message_page: null });
  return (
    <div
      className="space-y-6"
      data-testid={admin ? "admin-feedback" : "user-feedback"}
    >
      {!admin && (
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-widest text-violet">
              Chúng mình lắng nghe bạn
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Góp ý & hỗ trợ
            </h1>
            <p className="mt-2 text-sm text-fg-3">
              Gửi phản hồi và theo dõi trao đổi với quản trị viên.
            </p>
          </div>
          {!compose && (
            <button
              className="btn-glow inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm"
              onClick={() =>
                navigate({ feedback: null, compose: "1", message_page: null })
              }
            >
              <Plus className="size-4" />
              Gửi phản hồi mới
            </button>
          )}
        </header>
      )}
      {(ident || compose) && (
        <button className={button} onClick={back}>
          <ArrowLeft className="size-4" />
          {admin ? "Về hộp thư" : "Phản hồi của tôi"}
        </button>
      )}
      {compose && (
        <FeedbackForm
          sourcePath={safeFeedbackPath(params.get("from"))}
          onCreated={(item) => {
            navigate({ compose: null, from: null, feedback: item.id });
            onChanged?.();
          }}
        />
      )}
      {!compose && !ident && (
        <>
          <section className={panel}>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">
                {admin ? "Hộp thư phản hồi" : "Phản hồi của tôi"}
              </h2>
              <button
                className={button}
                disabled={list.pending}
                onClick={() => setRefresh((value) => value + 1)}
              >
                <RefreshCw className="size-4" />
                Làm mới danh sách
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm text-fg-2">
                Trạng thái
                <select
                  className={field}
                  value={validStatus}
                  onChange={(e) =>
                    navigate({ status: e.target.value, page: null }, true)
                  }
                >
                  <option value="">Tất cả trạng thái</option>
                  {Object.entries(feedbackStatuses).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 text-sm text-fg-2">
                Loại phản hồi
                <select
                  className={field}
                  value={validKind}
                  onChange={(e) =>
                    navigate({ kind: e.target.value, page: null }, true)
                  }
                >
                  <option value="">Tất cả loại</option>
                  {Object.entries(feedbackKinds).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {admin && (
              <form
                className="mt-3 flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  navigate(
                    { q: String(form.get("q") ?? "").trim(), page: null },
                    true,
                  );
                }}
              >
                <label className="min-w-0 flex-1 space-y-1.5 text-sm text-fg-2">
                  Tìm mã hoặc tiêu đề
                  <input
                    key={q}
                    name="q"
                    defaultValue={q}
                    maxLength={120}
                    className={field}
                  />
                </label>
                <button className={button}>Tìm kiếm</button>
                {q && (
                  <button
                    type="button"
                    className={button}
                    onClick={() => navigate({ q: null, page: null }, true)}
                  >
                    Xóa tìm kiếm
                  </button>
                )}
              </form>
            )}
          </section>
          {list.pending && (
            <p role="status" className="py-8 text-center text-fg-3">
              Đang tải phản hồi…
            </p>
          )}
          {list.error && (
            <p role="alert" className="rounded-xl bg-danger/10 p-4 text-danger">
              {list.error}
            </p>
          )}
          {list.data && (
            <>
              <p className="text-sm text-fg-3">{list.data.total} phản hồi</p>
              {!list.data.items.length && (
                <div className={`${panel} py-12 text-center`}>
                  <MessageSquare className="mx-auto mb-3 size-8 text-violet" />
                  <p className="font-medium">
                    {list.data.total
                      ? "Trang này không có phản hồi"
                      : validStatus || validKind || q
                        ? "Không có phản hồi phù hợp"
                        : "Chưa có phản hồi"}
                  </p>
                  <p className="mt-2 text-sm text-fg-3">
                    {admin
                      ? "Phản hồi từ người dùng sẽ xuất hiện tại đây."
                      : "Bạn có thể gửi lỗi gặp phải hoặc ý tưởng cải thiện PersonaX."}
                  </p>
                </div>
              )}
              <div className="space-y-3">
                {list.data.items.map((item) => (
                  <button
                    key={item.id}
                    className={`${panel} flex w-full items-start justify-between gap-3 text-left hover:border-violet/40`}
                    onClick={() =>
                      navigate({ feedback: item.id, message_page: null })
                    }
                  >
                    <span className="min-w-0">
                      <span className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-fg-3">
                          {item.code} · {feedbackKinds[item.kind]}
                        </span>
                        {!admin && item.unread && (
                          <span className="rounded-md bg-sky-300/10 px-2 py-1 text-xs text-sky-300">
                            Có cập nhật mới
                          </span>
                        )}
                      </span>
                      <span className="block break-words font-medium">
                        {item.title}
                      </span>
                      <span className="mt-2 block text-xs text-fg-3">
                        Cập nhật {feedbackDate(item.updated_at)}
                        {admin && item.priority
                          ? ` · Ưu tiên ${feedbackPriorities[item.priority]}`
                          : ""}
                      </span>
                    </span>
                    <span className="shrink-0">
                      <FeedbackBadge status={item.status} />
                    </span>
                  </button>
                ))}
              </div>
              <Pagination
                page={page}
                pages={Math.max(
                  1,
                  Math.ceil(list.data.total / list.data.page_size),
                )}
                onPage={(value) => navigate({ page: String(value) })}
              />
            </>
          )}
        </>
      )}
      {ident && (
        <>
          <div className="flex justify-end">
            <button
              className={button}
              disabled={thread.pending}
              onClick={() => setRefresh((value) => value + 1)}
            >
              <RefreshCw className="size-4" />
              Tải lại phản hồi
            </button>
          </div>
          {thread.pending && <p role="status">Đang tải trao đổi…</p>}
          {thread.error && (
            <p role="alert" className="rounded-xl bg-danger/10 p-4 text-danger">
              {thread.error}
            </p>
          )}
          {thread.data && (
            <>
              <section className={panel}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-fg-3">
                    {thread.data.feedback.code} ·{" "}
                    {feedbackKinds[thread.data.feedback.kind]}
                  </span>
                  <FeedbackBadge status={thread.data.feedback.status} />
                </div>
                <h2 className="break-words text-xl font-semibold">
                  {thread.data.feedback.title}
                </h2>
                <p className="mt-2 text-xs text-fg-3">
                  Gửi {feedbackDate(thread.data.feedback.created_at)}
                  {admin && thread.data.feedback.sender
                    ? ` · @${thread.data.feedback.sender.username}`
                    : ""}
                </p>
                <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-7">
                  {thread.data.feedback.body}
                </p>
                {thread.data.feedback.source_path && (
                  <p className="mt-4 break-all text-xs text-fg-3">
                    Trang liên quan: {thread.data.feedback.source_path}
                  </p>
                )}
              </section>
              {admin && (
                <>
                  {assignees.error && (
                    <p role="alert" className="text-danger">
                      {assignees.error}
                    </p>
                  )}
                  <ManageFeedback
                    key={`${thread.data.feedback.id}:${thread.data.feedback.version}`}
                    feedback={thread.data.feedback}
                    assignees={assignees.data}
                    onChanged={changed}
                  />
                </>
              )}
              <section className={panel}>
                <h2 className="mb-5 font-semibold">Lịch sử trao đổi</h2>
                {!thread.data.messages.length && (
                  <p className="text-sm text-fg-3">
                    Chưa có trao đổi. Quản trị viên sẽ phản hồi tại đây.
                  </p>
                )}
                <ol className="space-y-4">
                  {thread.data.messages.map((message) => (
                    <li
                      key={message.id}
                      className={`rounded-xl border p-4 ${message.internal ? "border-amber-300/20 bg-amber-300/5" : "border-white/5 bg-white/[0.02]"}`}
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={
                            message.internal ? "text-amber-300" : "text-violet"
                          }
                        >
                          {message.internal
                            ? "Ghi chú nội bộ"
                            : message.author_role === "admin"
                              ? "Quản trị viên"
                              : "Người gửi"}
                        </span>
                        <span className="text-fg-3">
                          {feedbackDate(message.created_at)}
                        </span>
                        {message.status && (
                          <FeedbackBadge status={message.status} />
                        )}
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm leading-7">
                        {message.body ||
                          "Trạng thái phản hồi đã được cập nhật."}
                      </p>
                    </li>
                  ))}
                </ol>
                {thread.data.message_pages > 1 && (
                  <Pagination
                    page={thread.data.message_page}
                    pages={thread.data.message_pages}
                    onPage={(value) =>
                      navigate({ message_page: String(value) }, true)
                    }
                  />
                )}
              </section>
              {admin ||
              !["resolved", "closed"].includes(thread.data.feedback.status) ? (
                <ReplyForm
                  key={ident}
                  admin={admin}
                  prefix={`${prefix}/${encodeURIComponent(ident)}`}
                  onChanged={changed}
                />
              ) : (
                <p className="rounded-xl bg-white/5 p-4 text-sm text-fg-3">
                  Phản hồi đã kết thúc. Nếu cần hỗ trợ thêm, hãy gửi phản hồi
                  mới.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Pagination({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (value: number) => void;
}) {
  return (
    <nav
      aria-label="Phân trang phản hồi"
      className="mt-5 flex flex-wrap items-center justify-between gap-3"
    >
      <button
        className={button}
        disabled={page <= 1}
        onClick={() => onPage(Math.min(page - 1, pages))}
      >
        <ArrowLeft className="size-4" />
        Trang trước
      </button>
      <span className="text-xs text-fg-3">
        Trang {page} / {pages}
      </span>
      <button
        className={button}
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Trang sau
        <ArrowRight className="size-4" />
      </button>
    </nav>
  );
}

function FeedbackForm({
  sourcePath,
  onCreated,
}: {
  sourcePath: string | null;
  onCreated: (item: Feedback) => void;
}) {
  const [kind, setKind] = useState<FeedbackKind>("bug");
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
          const item = await api<Feedback>(
            "/feedback",
            mutation({
              kind,
              title: String(form.get("title")).trim(),
              body: String(form.get("body")).trim(),
              source_path:
                sourcePath && form.get("include_path") ? sourcePath : null,
            }),
          );
          onCreated(item);
        } catch (error) {
          setError(errorText(error));
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg font-semibold">Gửi phản hồi mới</h2>
      <label className="block space-y-2 text-sm">
        Loại phản hồi
        <select
          className={field}
          value={kind}
          onChange={(e) => setKind(e.target.value as FeedbackKind)}
        >
          {Object.entries(feedbackKinds).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-2 text-sm">
        Tiêu đề
        <input
          className={field}
          name="title"
          required
          minLength={5}
          maxLength={120}
          placeholder="Mô tả ngắn vấn đề hoặc ý tưởng"
        />
      </label>
      <label className="block space-y-2 text-sm">
        Nội dung
        <textarea
          className={field}
          name="body"
          required
          minLength={20}
          maxLength={5000}
          rows={7}
          placeholder={
            kind === "bug"
              ? "Bước tái hiện:\nKết quả mong đợi:\nKết quả thực tế:"
              : "Bạn mong muốn PersonaX cải thiện điều gì?"
          }
        />
      </label>
      <p className="text-xs text-fg-3">
        Nội dung từ 20 đến 5.000 ký tự. Không gửi mật khẩu hoặc mã xác thực.
      </p>
      {sourcePath && (
        <label className="flex items-start gap-3 text-sm text-fg-2">
          <input className="mt-1" type="checkbox" name="include_path" />
          <span>
            Đính kèm đường dẫn trang:{" "}
            <span className="break-all">{sourcePath}</span>
          </span>
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button
        disabled={busy}
        className="btn-glow inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm"
      >
        <Send className="size-4" />
        {busy ? "Đang gửi…" : "Gửi phản hồi"}
      </button>
    </form>
  );
}

function ReplyForm({
  admin,
  prefix,
  onChanged,
}: {
  admin: boolean;
  prefix: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className={`${panel} space-y-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const form = e.currentTarget;
        const body = String(new FormData(form).get("body")).trim();
        setBusy(true);
        setError("");
        try {
          await api(
            `${prefix}/messages`,
            mutation(admin ? { body, internal } : { body }),
          );
          form.reset();
          setInternal(false);
          onChanged();
        } catch (error) {
          setError(errorText(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="font-semibold">
        {admin ? "Trả lời hoặc ghi chú" : "Bổ sung thông tin"}
      </h2>
      {admin && (
        <label className="flex items-center gap-2 text-sm text-amber-300">
          <input
            type="checkbox"
            checked={internal}
            onChange={(e) => setInternal(e.target.checked)}
          />
          Ghi chú nội bộ — chỉ quản trị viên xem được
        </label>
      )}
      <label className="block space-y-2 text-sm">
        {internal ? "Nội dung ghi chú" : "Nội dung trao đổi"}
        <textarea
          name="body"
          className={field}
          required
          minLength={3}
          maxLength={5000}
          rows={4}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button className={button} disabled={busy}>
        <Send className="size-4" />
        {busy ? "Đang gửi…" : internal ? "Lưu ghi chú" : "Gửi trao đổi"}
      </button>
    </form>
  );
}

function ManageFeedback({
  feedback,
  assignees,
  onChanged,
}: {
  feedback: Feedback;
  assignees?: Assignee[];
  onChanged: () => void;
}) {
  const [status, setStatus] = useState(feedback.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reasonRequired =
    status !== feedback.status && ["resolved", "closed"].includes(status);
  return (
    <form
      className={`${panel} space-y-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          await api(`/admin/feedback/${feedback.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              version: feedback.version,
              status,
              priority: form.get("priority"),
              assignee_id: form.get("assignee_id") || null,
              reason: String(form.get("reason")).trim(),
            }),
          });
          onChanged();
        } catch (error) {
          setError(errorText(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="size-4 text-violet" />
        Xử lý phản hồi
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-2 text-sm">
          Trạng thái xử lý
          <select
            className={field}
            value={status}
            onChange={(e) => setStatus(e.target.value as FeedbackStatus)}
          >
            {Object.entries(feedbackStatuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          Mức ưu tiên
          <select
            name="priority"
            className={field}
            defaultValue={feedback.priority}
          >
            {Object.entries(feedbackPriorities).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          Người xử lý
          <select
            name="assignee_id"
            className={field}
            defaultValue={feedback.assignee_id ?? ""}
            disabled={!assignees}
          >
            <option value="">Chưa phân công</option>
            {feedback.assignee_id &&
              !assignees?.some((item) => item.id === feedback.assignee_id) && (
                <option value={feedback.assignee_id}>
                  Người xử lý hiện tại
                </option>
              )}
            {assignees?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} (@{item.username})
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-2 text-sm">
        Lời giải thích công khai{" "}
        {reasonRequired ? "(bắt buộc)" : "(khi đổi trạng thái)"}
        <textarea
          name="reason"
          className={field}
          rows={3}
          required={reasonRequired}
          disabled={status === feedback.status}
          minLength={3}
          maxLength={5000}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button className={button} disabled={busy || !assignees}>
        {busy ? "Đang lưu…" : "Lưu xử lý"}
      </button>
    </form>
  );
}
