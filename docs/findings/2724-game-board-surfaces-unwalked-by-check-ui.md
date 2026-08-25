---
title: check:ui cannot walk the game board, so no card-corner or ring change can be measured where cards actually live
discoveredBy: 2724
status: draft
confidence: high
---

**What is wrong.** `scripts/ui-gate/budgets.json` marks `game-board`,
`game-stress` and `limited-build` as `"status": "unwalked"`, and the lane skips
them without failing. Every other surface it walks shows cards through the
lobby/deck-builder/draft path only. Issue #2724's acceptance criteria asked for
a `check:ui` receipt on "board (full fixture scenario)" — the lane structurally
cannot produce one, so the board half of a card-surface change is verified by
hand-driven CDP or not at all.

**Evidence.** `scripts/ui-gate/budgets.json` — `"game-board": {"label": …,
"status": "unwalked", "reason": …}` with an empty `viewports` object (the same
for `game-stress`, `limited-build`); `scripts/ui-gate/budgets.ts` treats
`unwalked` as "skipped, printed, not a failure" (see the `SurfaceBudget`
doc comment). The new `cardsSquare` check added in #2724 therefore has ceilings
recorded on 13 surfaces and none on the three where the battlefield card,
the hand card, the pile fans, the stack thumbs and every state ring live.

**Why it may not deserve its own issue.** The `unwalked` rows are deliberate and
predate this ticket — walking the board needs a seeded game (a debug scenario
plus a solo-mode click sequence), which is a real chunk of lane work and is
plausibly already implied by whatever ticket owns those three rows. If such a
ticket exists this is a comment on it, not a new one. It is written down because
the gap is invisible from a green `check:ui` run: the lane prints the surfaces
it skipped, and a reader easily takes 13/13 budgeted surfaces green as full
coverage.
