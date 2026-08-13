---
title: The `choice` Op has no single-candidate auto-resolve, so a forced pick still suspends on a prompt
discoveredBy: 2374
status: draft
confidence: medium
---

**What is wrong.** A `choice` Op with `kind: "choose-permanents"` (and, as far
as the executor is concerned, every other kind) raises a real `PendingChoice`
even when exactly ONE candidate exists and the count is 1 — i.e. when there is
no decision to make. The project norm is to auto-resolve a choice with no real
option and keep the prompt only for a tactical zero-branch one; that norm is
implemented for cost-payment legs (`autoResolveFungible`,
`convex/gre/pendingChoiceSubmit.ts`) but not for the general `choice` Op.

**Evidence.** `convex/gre/effects/interpreter.ts:4221-4260` clamps `count` to
the number of available candidates and returns early only at `count <= 0`;
above zero it calls `ctx.requestChoice(...)` unconditionally.
`SpellContext.requestChoice` (`convex/gre/state.ts:14702-14748`) always pushes
a fresh `PendingChoice` and returns `undefined` (suspend) on first entry —
there is no candidate-count branch anywhere in that path.

Amass (CR 701.47, this issue) hit it directly: "Choose an Army creature you
control" is a forced pick on every board this catalogue can currently reach
(amass only creates a token when you control no Army, so you end up with
exactly one). `convex/cards/abilities/amass.ts` works around it by gating the
`choice` Op behind an `if` on the Army count — the forced 0/1-Army path
iterates the Army with `forEach` and raises nothing, the 2+-Army path prompts.
That workaround is correct but is per-script; any other card whose choice
happens to have one legal candidate still prompts.

**Why it may not deserve its own issue.** The general fix is not obviously
safe: several shipped cards' tests assert the prompt exists, some
single-candidate prompts are genuinely informative (the player learns what the
only legal option was), and `{ min: 0, max: N }` ranges are a real decision at
one candidate (take it or not). So this may be a per-kind opt-in flag rather
than blanket behaviour — which is closer to a design question for the
`choice` Op than a bug ticket, and possibly a line on the DSL tracker rather
than a slice of its own.
