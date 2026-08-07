---
title: The Manual Board's controller menu button is wired to a no-op
discoveredBy: 2169
status: draft
confidence: low
---

**What is wrong.** All three controller layouts take an `onOpenMenu` callback
and render a menu button from it (`controller.tsx:28`). On the GRE board
`board.tsx` wires it to `PauseMenuDialog` — leave game, concede the match,
switch game. The Manual Board passes a no-op, so the button renders and does
nothing.

`PauseMenuDialog` was not wired because it is GRE-shaped: it reaches
`api.game.concede` / `leaveGame` / the match record, none of which a manual game
has in the same form (`manualConcede` / `manualConcedeMatch` are separate
mutations). Concede IS reachable — it is one of the five manual controller
descriptors — so nothing is unreachable, only the button is dead.

**Evidence.** `src/components/board/manual-board-view.tsx` passes
`NO_SWITCH_GAME` as `onOpenMenu`; `src/components/board/controller.tsx:28`;
`src/components/board/board.tsx` mounts `PauseMenuDialog` as a sibling with the
real handler.

**Why it may not deserve its own issue.** A dead button is a one-line fix in
whichever ticket next touches the manual controller (#2172 or #2173), and
"hide the button when no handler is supplied" is a shared-component change
better made once for both boards than as a manual-only patch.
