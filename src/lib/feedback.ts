export const feedbackKinds = {
  bug: "Báo lỗi",
  feature: "Đề xuất tính năng",
  other: "Góp ý khác",
} as const;
export const feedbackStatuses = {
  new: "Mới",
  reviewing: "Đang xem xét",
  planned: "Đã lên kế hoạch",
  resolved: "Đã giải quyết",
  closed: "Đã đóng",
} as const;
export const feedbackPriorities = {
  low: "Thấp",
  normal: "Bình thường",
  high: "Cao",
  urgent: "Khẩn cấp",
} as const;
export type FeedbackKind = keyof typeof feedbackKinds;
export type FeedbackStatus = keyof typeof feedbackStatuses;
export type Feedback = {
  id: string;
  code: string;
  kind: FeedbackKind;
  title: string;
  body: string;
  status: FeedbackStatus;
  source_path: string | null;
  created_at: number;
  updated_at: number;
  public_updated_at: number;
  unread: boolean;
  priority?: keyof typeof feedbackPriorities;
  assignee_id?: string | null;
  version?: number;
  sender?: { id: string; username: string; name: string };
};
export type FeedbackList = {
  items: Feedback[];
  total: number;
  page: number;
  page_size: number;
};
export type FeedbackThread = {
  feedback: Feedback;
  messages: {
    id: string;
    body: string;
    internal: boolean;
    status: FeedbackStatus | null;
    author_role: string;
    created_at: number;
  }[];
  message_page: number;
  message_pages: number;
};
export type Assignee = { id: string; username: string; name: string };
export const feedbackDate = (at: number) =>
  new Date(at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
export function safeFeedbackPath(value: string | null): string | null {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return null;
  return value.split(/[?#]/)[0].slice(0, 500);
}
