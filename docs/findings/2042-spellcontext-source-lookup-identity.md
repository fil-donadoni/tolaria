---
title: Nine SpellContext reads locate the trigger source by a reused instance id, so a blinked source reads (or writes) the wrong object
discoveredBy: 2042
status: declined
confidence: medium
declinedReason: >
    Not a standalone ticket. Written while #2042 was open, on the expectation
    that its fix would replace the shared lookup expression. It did not: #2042
    shipped as a departure-time LKI snapshot on the STACK ITEM
    (StackItem.sourceLki), read only by the interveningIf re-check, so all nine
    buildSpellContext sites below survive unchanged. The per-site
    LKI-vs-no-op table is still the useful artifact — a triggerSourceId-aware
    findOnBattlefield consulting sourceLki would fix them uniformly — but the
    "why it may not deserve its own issue" caveat below is unchanged and
    nothing here is yet proven by a failing test.
---

**What is wrong.** #2042 fixes the `interveningIf` re-check's use of
`findOnBattlefield(state, top.triggerSourceId)`. The same lookup expression —
`findOnBattlefield(state, item.triggerSourceId ?? item.id)` — appears nine more
times inside `buildSpellContext` (`convex/gre/state.ts:10352`), and every one
carries the same CR 400.7 identity hazard: a permanent that left and re-entered
the battlefield under the same instance id is a **new object**, but the lookup
cannot tell.

**Evidence.** All nine sites, with the correct behaviour per CR 608.2h:

| site             | method                            | should be                                                                                                    |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `state.ts:10422` | `getAttachedToId()`               | LKI — "what did I enter attached to"; the real consumer is Earthbind's own ETB (`cards/sets/lea/red.ts:240`) |
| `state.ts:10444` | `getChosenPlayer()`               | LKI                                                                                                          |
| `state.ts:10476` | `getChosenModeId()`               | LKI                                                                                                          |
| `state.ts:10430` | `setChosenPlayer()`               | **no-op** if the source left — currently writes the choice onto the impostor                                 |
| `state.ts:10452` | `setChosenSubtypes()`             | no-op, same                                                                                                  |
| `state.ts:10501` | `becomeCopyOf()` recipient lookup | no-op, same                                                                                                  |
| `state.ts:10507` | `setSelfBody()`                   | no-op, same                                                                                                  |
| `state.ts:10543` | `setSelfChosenName()`             | no-op, same                                                                                                  |
| `state.ts:14608` | `markEchoPaid()`                  | clears a flag on an object that never owed it                                                                |

The `fight` site (`state.ts:10792` → `resolveFight` `:7736`, `findOnBattlefield`
at `:7741`) is the same shape but is **already owned by #2012**.

**Why it may not deserve its own issue.** Nothing here is proven — this is a
read of the code, not a failing test, and no shipped card is known to reach any
of these paths after a blink. The write sites in particular may be harmless in
practice: several are only ever called during the entering permanent's own ETB
resolution, where the source cannot have left yet. Worth a per-site
reproduction attempt before ticketing; if only one or two are real, they are
lines on #2042's follow-up rather than a ticket of their own.

The cheap structural angle, if it does earn a ticket: all nine share one
expression, so a `triggerSourceId`-aware variant of `findOnBattlefield` that
consults the identity signal #2042 introduces would fix them uniformly instead
of needing nine patches.
