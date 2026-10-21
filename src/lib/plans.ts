export type PlanCode = "free" | "basic" | "plus" | "premium";
export type PaidPlanCode = Exclude<PlanCode, "free">;

export type PublicPlan = {
  code: PlanCode;
  label: string;
  rank: number;
  price_vnd: number;
  duration: string | null;
  description: string;
  enabled: boolean;
  discount_percent: number;
  closed_message: string | null;
};

type PlanMeta = {
  label: string;
  rank: number;
  paid: boolean;
  /** Limits described in words; exact quotas stay server-side. */
  features: string[];
  recordingSeconds: number;
};

export const PLAN_META: Record<PlanCode, PlanMeta> = {
  free: {
    label: "Free",
    rank: 0,
    paid: false,
    features: [
      "Khám phá các nhân vật",
      "Trò chuyện với giới hạn cơ bản",
      "Dùng thử nghe và nhập giọng nói",
    ],
    recordingSeconds: 60,
  },
  basic: {
    label: "Basic",
    rank: 1,
    paid: true,
    features: [
      "Trò chuyện nhiều hơn mỗi ngày",
      "Tạo thêm nhân vật riêng",
      "Nghe nhân vật đọc lời thoại thường xuyên",
    ],
    recordingSeconds: 90,
  },
  plus: {
    label: "Plus",
    rank: 2,
    paid: true,
    features: [
      "Hội thoại dài và nhớ ngữ cảnh tốt hơn",
      "Nhiều thời lượng nghe và nhập giọng nói",
      "Phù hợp trò chuyện hằng ngày",
    ],
    recordingSeconds: 120,
  },
  premium: {
    label: "Premium",
    rank: 3,
    paid: true,
    features: [
      "Giới hạn rộng nhất cho trò chuyện",
      "Ngữ cảnh dài nhất, câu trả lời dài hơn",
      "Thoải mái gọi và nghe giọng nói",
    ],
    recordingSeconds: 120,
  },
};

export const planLabel = (code: string | null | undefined) =>
  code && code in PLAN_META ? PLAN_META[code as PlanCode].label : "Free";

export const recordingSeconds = (code: string | null | undefined) =>
  code && code in PLAN_META
    ? PLAN_META[code as PlanCode].recordingSeconds
    : PLAN_META.free.recordingSeconds;
