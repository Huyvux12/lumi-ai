import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers.mjs";
const { safeNext } = load("src/lib/nav.ts");
const { shouldPollOrder, BILLING_POLL_WINDOW_MS } = load("src/lib/billing.ts");

test("post-login destinations stay on the app origin", () => {
  for (const bad of ["//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "javascript:alert(1)", "https://evil.example", undefined])
    assert.equal(safeNext(bad), "/");
  assert.equal(safeNext("/chat/example?scene=room#message"), "/chat/example?scene=room#message");
  assert.equal(safeNext(["/profile", "//evil.example"]), "/profile");
});

test("late payment polling includes expired and review orders but is bounded", () => {
  const created = 1000;
  for (const status of ["pending", "expired", "review"])
    assert.equal(shouldPollOrder({ status, created_at: created }, created + 1000), true);
  for (const status of ["paid", "refunded", "cancelled"])
    assert.equal(shouldPollOrder({ status, created_at: created }, created + 1000), false);
  assert.equal(shouldPollOrder({ status: "expired", created_at: created }, created + BILLING_POLL_WINDOW_MS), false);
});
