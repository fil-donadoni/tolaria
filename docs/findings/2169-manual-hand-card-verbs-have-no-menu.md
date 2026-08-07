---
title: Manual hand cards lost their verb menu in the swap — play face down / reveal / library-top-or-bottom have no affordance
discoveredBy: 2169
status: draft
confidence: high
---

**What is wrong.** Issue #2169's "What to build" lists a hand-card verb set —
"play, play face down, discard, reveal, to library top or bottom" — riding the
shared ability menu. It does not, and could not without a sixth injection seam.

The shared hand renders `BoardHandCard` (`src/components/board/board-hand.tsx:224`)
for the viewer's own hand, and that component is hard-wired to the GRE: it calls
`useHandCardCommit`, `useMutation(api.game.activateAbility)` and
`getHandStackAbilities` directly (`board-hand-card.tsx:135`, `:191`, `:211`).
Mounted against a manual `gameId` every one of those dispatches at a
`gameStates` row that does not exist, so #2169 opted the manual hand out
entirely (`BoardSurface`'s new `handInteractive={false}`) and its cards render
through the presentational `BoardCard`, which has no menu at all.

What survives: **discard** (drag hand → graveyard), **play** (drag hand →
battlefield), **to library** (drag hand → library tile), plus "turn face down"
once the card is on the battlefield. What is genuinely gone: **play face down**
as one gesture, **reveal** (`api.game.manualReveal` is shipped server-side and
now has no client caller at all), and **library TOP vs BOTTOM** — the drag
always uses `manualMoveCard`'s default index.

**Evidence.** `src/components/board/board-hand.tsx:224` (`interactive && card`
→ `BoardHandCard`); `src/components/board/board-hand-card.tsx:135,191,211` (the
three GRE call sites); `src/components/board/board-surface.tsx` (`handInteractive`,
default `true`, manual passes `false`); `convex/game.ts:14887` (`manualReveal`,
now uncalled from the client). The battlefield equivalent DID get its seam —
`useBattlefieldInteractionContext` (#2166) — which is the shape a hand seam
would copy: a `HandCardInteractionHook` carrying the hook, resolved inside
`BoardHandCard`, defaulting to today's wiring.

**Why it may not deserve its own issue.** #2170 already owns "replace the
manual board's native prompts with real dialogs" and #2171 owns arrows /
attachment clusters, so a hand-card verb sheet may belong inside #2170's scope
rather than as a ticket of its own. It is also possible the drag gestures cover
enough of the workflow in practice that only `reveal` is genuinely missed — and
`reveal` is a two-player affordance in a mode used mostly solo.
