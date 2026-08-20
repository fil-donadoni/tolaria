---
title: check:ui has no coverage for the game board / Draft Room surfaces or for dvh/safe-area correctness
discoveredBy: 2594
status: draft
confidence: high
---

**What is wrong.** `scripts/ui-gate/budgets.json` lists `game board`,
`game board stress`, `limited pool builder` and `draft pick screen` as
`status: "unwalked"` — the lane cannot reach either surface this issue mounts
`OrientationHint` on (`src/routes/game.route.tsx`'s "playing" branch,
`src/components/limited/limited-event-detail.tsx`'s `draftInProgress` block).
Separately, the budget schema itself has no key for viewport-unit
correctness or safe-area measurement at all (only `cardsZero/cardsOcc/
cardsStranded`, `ctrlsZero/ctrlsOcc/ctrlsStranded`, `starved`, `axeSerious/
axeCritical`) — so even a walked surface would not catch a `100vh` regression
or a missing `env(safe-area-inset-*)`.

**What covers it instead.** The `100vh` repeat-offender risk is covered by a
new repo-wide grep guard, `src/lib/__tests__/no-bare-100vh.guard.test.ts`
(issue #2594) — mechanical, not `check:ui`-dependent. The
`OrientationHint`/manifest/viewport-meta work is covered by hand-written dom
tests (`orientation-hint.test.tsx`, `pwa-manifest.test.ts`), each with a
proven proof-of-failure. What is NOT covered by any automated check: whether
`env(safe-area-inset-bottom)` actually renders non-zero padding on a real
notched device now that `viewport-fit=cover` is set (issue #2594) — Chrome's
`emulate` viewport profiles used by `check:ui` do not simulate a device safe
area inset, so this can only be confirmed live (Chrome DevTools' "Show device
frame" + a notched device preset, or a real phone).

**Why it may not deserve its own issue.** Walking `/game` and `/limited/
$eventId` while drafting through `check:ui` is real, valuable, pre-existing
scope (the two "unwalked" rows predate this issue) — better tracked as its own
`check:ui` runbook-coverage ticket than folded into this one. A dedicated
`safe-area`/`dvh` budget key is a bigger design question (what would the
budget even assert, given CDP has no first-class safe-area-inset override at
the time of writing) and is worth grilling before committing to a shape.
