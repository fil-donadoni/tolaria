---
title: A plain resolve() body replays in full when an as-enters park suspends its resolution
discoveredBy: 2558
status: triaged
issue: 2570
confidence: high
---

**What is wrong.** ADR 0100 D5's replay table prices re-entry for the two
CHECKPOINTED bodies — a stepped `resolveSteps` (resumes at `top.resolutionStep`)
and an Effect Script (`runOpList` skips every Op below the resume position). It
does not price the third shape: a plain imperative `resolve()` closure. That one
carries no checkpoint at all, so when an as-enters park suspends its resolution
the stack item is left in place and the WHOLE closure re-runs from its first
line — including every side effect it already committed.

Measured with a synthetic trigger whose `resolve()` gains 1 life and then calls
`ctx.createTokenCopyOf` on a Voice of All: after answering the single colour
choice the controller had gained **2 life**, and a **second** token was staged
and parked (a third would follow, and so on).

**Evidence.**

- `convex/gre/state.ts` `resolutionSuspendedOnChoice` — exempts only a stackless
  `land-entry-tapped` choice; an as-enters park (`stackItemId: ""`,
  `asEntersCardId` set) counts as a suspension, so the 16 call sites that guard
  a resolution body all `return null` and leave the item on the stack.
- `convex/gre/state.ts` — the plain-`resolve()` branches for a spell, a
  triggered ability, an activated ability and each of their modal variants call
  that predicate identically to the checkpointed ones; there is no
  "the body already ran to completion" distinction anywhere.
- `convex/gre/asEnters.ts` `resumeAfterStagedEntry` then takes the
  `resolveTopOfStack` branch, because `parkedStackItemId` really is still live.
- The one shipped producer this reaches today is Sin, Spira's Punishment
  (`convex/cards/sets/fin/multicolor.ts`), fixed IN #2558 with a per-body
  run-to-completion marker (`ctx.recallChoice` / `ctx.noteChoice`) — the same
  idempotent-commit idiom the `createToken` / `createTokenCopy` Ops use.

**The general fix, if it is wanted.** A plain `resolve()` body has, by
construction, nothing left to resume once it returns: the correct amount of it
to re-run is zero. So the predicate at the plain-`resolve()` sites should ignore
a stackless as-enters park and fall through to `state.stack.pop()`, letting the
as-enters finalize's own no-live-parking-item branch (ADR 0100 D5 outcome 3) run
the entry tail. That is NOT the blanket exemption D5 rejected — D5 rejected
exempting as-enters parks everywhere, on the grounds that "the rest of the
resolution would run without" the permanent, which is precisely what does not
apply to a body that has already finished.

**Why it may not deserve its own issue — resolved: it did.** The hedge below was
written before the sweep ran, and the sweep refuted it. Measured on `main` with a
plain `resolve()` that gains 1 life and then puts a card declaring an As-Enters
Choice onto the battlefield: the controller went 20 -> 21 -> 22, i.e. the body ran
twice. The row B analogue is not hypothetical and Sin is not the only reachable
producer — a census of plain-`resolve()` bodies calling a battlefield-entering
primitive comes back non-empty, and any generic reanimation or put-onto-battlefield
effect can reach one of the wired As-Enters declarations. By this file's own
closing test that makes it "a bug with a blast radius", so it was cut as #2570.

The original hedge, kept for provenance: only one shipped card reaches it through
the token-copy path and that one is now guarded card-side, so if the sweep had
come back empty apart from Sin this would have been a line on ADR 0100 rather
than a ticket.
