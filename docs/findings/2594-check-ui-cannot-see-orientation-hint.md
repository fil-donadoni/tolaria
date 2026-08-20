---
title: check:ui has no coverage for the game board surface or for dvh/safe-area correctness
discoveredBy: 2594
status: draft
confidence: high
---

**What is wrong (updated after the #2646 rebase, PR #2645 round 3).**
`scripts/ui-gate/budgets.json` still lists `game-board` and `game-stress` as
`status: "unwalked"` — the lane cannot reach the board surface this issue
mounts `OrientationHint` on (`src/routes/game.route.tsx`'s "playing" branch).
**This is now only HALF true.** The Draft Room mount originally lived in
`src/components/limited/limited-event-detail.tsx`'s `draftInProgress` block;
#2646 replaced that block with its own route,
`src/components/limited/limited-draft-room.tsx`, and the rebase that landed
this PR on top of #2646 silently dropped the mount along with it (restored in
the round-4 fixup, now gated on `useViewportMode() === "portrait"` above
`<LimitedDraftTable>`). That surface, `draft-pick` (`/limited/<id>/draft`), is
`status: "budgeted"` in HEAD's `budgets.json` — #2646 walked it at all five
viewports — so **the restored Draft Room mount IS now reachable by
`check:ui`**, unlike the board mount. The premise of this finding (both
mounts unreachable) has partly dissolved; only the board half stands.

Separately, the budget schema itself has no key for viewport-unit
correctness or safe-area measurement at all (only `cardsZero/cardsOcc/
cardsStranded`, `ctrlsZero/ctrlsOcc/ctrlsStranded`, `starved`, `axeSerious/
axeCritical`) — so even a walked surface would not catch a `100vh` regression
or a missing `env(safe-area-inset-*)`.

**What covers it instead.** The `100vh` repeat-offender risk is covered by a
new repo-wide grep guard, `src/lib/__tests__/no-bare-100vh.guard.test.ts`
(issue #2594) — mechanical, not `check:ui`-dependent. The
`OrientationHint`/manifest/viewport-meta work is covered by hand-written dom
tests (`orientation-hint.test.tsx`, `pwa-manifest.test.ts`, plus the round-4
surface-level guards `game.route.orientation-hint.test.tsx` and the
`limited-draft-room.test.tsx` mount describe block), each with a proven
proof-of-failure. What is NOT covered by any automated check: whether
`env(safe-area-inset-bottom)` actually renders non-zero padding on a real
notched device now that `viewport-fit=cover` is set (issue #2594) — Chrome's
`emulate` viewport profiles used by `check:ui` do not simulate a device safe
area inset, so this can only be confirmed live (Chrome DevTools' "Show device
frame" + a notched device preset, or a real phone).

**Why it may not deserve its own issue.** Walking `/game` through `check:ui`
is real, valuable, pre-existing scope (the `game-board`/`game-stress` rows
predate this issue and `game-board`'s own `reason` field already explains why
it was measured and withdrawn — a hand-fan overlap that flaps between runs)
— better tracked as its own `check:ui` runbook-coverage ticket than folded
into this one. A dedicated `safe-area`/`dvh` budget key is a bigger design
question (what would the budget even assert, given CDP has no first-class
safe-area-inset override at the time of writing) and is worth grilling before
committing to a shape.
