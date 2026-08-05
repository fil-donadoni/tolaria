---
title: A payment park with no legal payment spins the bot instead of cancelling — pickForOwedPayment returns null and nothing cancels the announcement
discoveredBy: 1209
status: draft
confidence: medium
---

**What is wrong.** ADR 0091's anti-stall guarantee has one hole left. When
`pickForOwedPayment` returns `null` — no legal payment for the parked leg — the
generic `pay-owed-payment` branch is skipped, `decideNonChoiceAction` falls
through to `pass`, and the server rejects a pass while an announcement is parked.
The driver's `.catch` clears `lastSignature`, so the same state is re-driven: a
spin loop rather than a submitted payment. `convex/gre/paymentPicks.ts` says "the
payer must cancel", and nothing cancels.

**Evidence.** `src/lib/ai/brain.ts` (`decideNonChoiceAction`, the
`pay-owed-payment` branch only fires on a non-null submission) and
`convex/gre/paymentPicks.ts`'s null returns. The reachable trigger is a STALE
payload: the pick was computed against one state and the board changed before it
was submitted — Drought enters between search and execution, an opponent's
response removes the only legal victim in reply to the announcement.

**Why it may not deserve its own issue.** It is not a regression — before #1209
the bot simply stalled on the same states, so this strictly narrows the failure
rather than widening it — and it is outside #1209's acceptance criteria, which
are about the park LIST and the parks that DO have a legal payment. The real fix
is a capability the bot does not have at all today: a `cancelCast` /
`cancelActivation` fallback for "I announced something I can no longer pay",
which is a decision about bot policy (when may the bot retract an announcement?)
more than a bug fix. That argues for a small design ticket rather than a bug, or
for a line on an existing bot tracker.
