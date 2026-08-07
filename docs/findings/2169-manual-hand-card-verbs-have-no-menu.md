---
title: Manual hand cards have no verb menu after the swap — the pre-swap context menu was REMOVED, and play face down / reveal / library-top-or-bottom were never added
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

**A pre-existing menu was dropped, not merely not added.** The deleted
`manual-board.tsx` rendered HAND cards with the same `ManualCard` component as
battlefield cards (`manual-board.tsx:467` and `:538`), and `ManualCard` wrapped
every card in a `ContextMenu` carrying Tap/Untap, Turn face down, +1/+1, −1/−1,
damage counter, Clear damage, Custom counter and Set note
(`manual-board.tsx:764-953`). So the swap leaves the hand short in two distinct
ways, and only the first is a regression:

1. **Removed** (existed before this PR): the hand card's context menu — turn a
   hand card face down, put counters or a note on it (`board-hand.tsx:224`, the
   `interactive && card` branch that now always falls through to `BoardCard`).
2. **Never built** (nothing here is a loss): **play face down** as one gesture,
   **reveal** (`api.game.manualReveal` is shipped server-side and now has no
   client caller at all), and **library TOP vs BOTTOM** — the drag always uses
   `manualMoveCard`'s default index. Hand **reordering** belongs in this column
   too, in a sharper sense: `canReorder` (`board-hand.tsx:208`) is a
   SHARED-surface affordance the deleted board never had. Grepping the deleted
   file at `origin/main` for `index` or `reorder` returns nothing: its drag
   resolved to attach / lane / zone-move only, and `manualMoveCard` was never
   passed an index. Opting out of `handInteractive` therefore DECLINES an
   affordance the manual board would have gained; it does not lose one.

What survives: **discard** (drag hand → graveyard), **play** (drag hand →
battlefield), **to library** (drag hand → library tile), **exile** (drag hand →
exile tile), plus "turn face down" / counters / note once the card is on the
battlefield — i.e. the removed verbs of (1) are all still reachable, one drag
later. That is why the cut is defensible; it is not why it is invisible.
Whichever ticket picks up the hand seam should scope the RESTORE of (1)
alongside the new verbs of (2).

**Evidence.** `src/components/board/board-hand.tsx:208,224` (`canReorder`;
`interactive && card` → `BoardHandCard`, else the menu-less `BoardCard`);
deleted `manual-board.tsx:467,538,764-953` (hand cards rendered by `ManualCard`,
and `ManualCard`'s context menu);
`src/components/board/board-hand-card.tsx:135,191,211` (the
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
