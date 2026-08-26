---
title: the ui-gate `lobby` surface asserts only that a <main> exists, so a lobby that dropped every action would still walk green
discoveredBy: 2726
status: draft
confidence: high
---

**What is wrong.** The `lobby` surface is the app's primary destination and the
one the ui-gate walks first, but its walk performs no interaction and asserts a
single thing: that a visible `main` element rendered. Every measured verdict on
that surface (probe counts, axe, budgets) is therefore taken against whatever
the route happened to paint — a lobby that silently lost "Solo table
(Cockatrice)", "New preset (admin)" or the whole deck collection would produce
a clean `RECEIPT` row.

This mattered concretely for #2726, which replaced the lobby's entire
structure: the only net under that change was the 12 dom test files in
`src/components/lobby/__tests__/`, not the gate that the PR pastes a receipt
from.

**Evidence.** `scripts/ui-gate/surfaces.ts:729-737`:

```ts
{
    id: "lobby",
    label: "Lobby (/)",
    async walk(page, ctx) {
        await goto(page, ctx, "/");
        if (!(await visible(page, "main, [role=main]", 10_000))) {
            throw new Unreachable("the lobby rendered no main region");
        }
    },
}
```

Compare `deck-builder` two entries below, which at least asserts
`"input, button"`. Neither is an action census, but the lobby's is the weaker
of the two, and the lobby is the surface with the most distinct entry points in
the app (23 by the census in #2726's brief).

**Why it may not deserve its own issue.** Widening a walk costs runtime on
every viewport of every run, and the honest fix is not "assert more selectors"
— it is a named-affordance census the lane can check, which is a lane-design
question for #2580's owner rather than a lobby bug. It may also be the right
call that the dom project owns action coverage and the ui-gate owns only
layout/a11y, in which case this is a `declined` with that sentence written
down. What should not happen is the current state, where nobody has said which.
