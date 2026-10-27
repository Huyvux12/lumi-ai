export type AdminTab =
  | "summary"
  | "users"
  | "orders"
  | "plans"
  | "prompts"
  | "providers"
  | "voices"
  | "characters"
  | "scenes"
  | "reports"
  | "feedback"
  | "audit";
export type DashboardActivity = {
  id: string;
  action: string;
  target: string;
  created_at: number;
  actor: string | null;
};
export type DashboardQueue = {
  characters_pending: number;
  reports_open: number;
  payments_review?: number;
  feedback_new?: number;
};
export type DashboardDay = {
  date: string;
  revenue_vnd: number;
  chat_turns: number;
  stt_requests: number;
  tts_requests: number;
};
export type ModerationDashboard = {
  scope: "moderation";
  generated_at: number;
  queue: DashboardQueue;
  activity: DashboardActivity[];
};
export type BusinessDashboard = {
  scope: "admin";
  generated_at: number;
  period: { days: number; start: string; end: string; timezone: string };
  metrics: {
    revenue_vnd: number;
    new_users: number;
    active_users: number;
    total_users: number;
    premium_users: number;
    /** Accounts on a gifted invite period (trial or reward); never counted as paying. */
    gifted_users?: number;
    referral_signups?: number;
    referral_qualified?: number;
  };
  previous: { revenue_vnd: number; new_users: number; active_users: number };
  series: DashboardDay[];
  usage: {
    chat_turns: number;
    stt_requests: number;
    tts_requests: number;
    stt_ms: number;
    tts_ms: number;
    released_requests: number;
    input_tokens: number;
    output_tokens: number;
    llm_estimated_usd: number;
    unpriced_llm_requests?: number;
    legacy_priced_requests?: number;
  };
  services: {
    groq: boolean;
    llm?: { name: string; model: string; configured: boolean };
    stt?: { name: string; model: string; configured: boolean };
    tts: boolean;
    sepay: boolean;
    sepay_environment: string;
    demo_llm: boolean;
  };
  queue: DashboardQueue;
  activity: DashboardActivity[];
};
export type DashboardData = BusinessDashboard | ModerationDashboard;
