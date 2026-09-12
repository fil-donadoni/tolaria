---
title: The client offers "Untap and refund" on a source the mutation refuses for tapTriggerCommitted
discoveredBy: 3451
status: draft
confidence: high
---

**What is wrong.** `tapUntap` refuses the untap-to-refund toggle for TWO reasons
(CR 106.4 / 603.3): the source's mana is already spent (`manaCommitted`), or its
most-recent tap-for-mana put a triggered ability on the stack
(`tapTriggerCommitted` — City of Brass' own becomes-tapped ping, a third-party
Manabarbs). The client's copy of that decision knows only the first, so it keeps
rendering the refund affordance on a City of Brass tapped for mana and the user
gets a thrown error instead of a disabled control.

**Evidence.** `src/lib/card-utils.ts:525` — `if (!card.isTapped ||
card.manaCommitted) return false;`, with no `tapTriggerCommitted` leg. The field
is not projected either: `src/types/game.ts:160` carries `manaCommitted` and
nothing beside it. The server-side decision is now one function,
`untapToggleRefusal` (`convex/game.ts`, issue #3451), but it lives in `game.ts`,
which the frontend may not import — ADR 0074 admits pure modules from
`convex/gre/` and `convex/limited/` only — so the duplication cannot simply be
deleted.

**Why it may not deserve its own issue.** The visible cost is one error toast on
a narrow path (a becomes-tapped trigger source, tapped for mana at priority,
then a misclick undo), and the state is correct either way — the mutation
refuses. Against that: the fix is small and structural (move the predicate under
`convex/gre/`, project `tapTriggerCommitted`, call it from `canRefundManaTap`),
and it retires a client/server duplication of a rules decision, which is the
class `.claude/rules/gre-development.md` § Frontend wiring analysis exists for.
