export const BILLING_POLL_WINDOW_MS = 30 * 60 * 1000;
export function shouldPollOrder(order: { status: string; created_at: number }, now = Date.now()) {
  return ["pending", "expired", "review"].includes(order.status) &&
    now < order.created_at + BILLING_POLL_WINDOW_MS;
}
