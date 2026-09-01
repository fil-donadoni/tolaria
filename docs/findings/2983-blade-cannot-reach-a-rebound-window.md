---
title: No blade setup primitive can reach a Rebound cast window, because none can advance the turn to a future upkeep
discoveredBy: 2983
status: draft
confidence: high
---

**What is wrong.** #2983 turns both reflexive cast windows into in-tree ISMCTS
decision nodes and ships a `must`-tier blade pair for Madness. Rebound gets
none, and not by choice: the blade harness's `setup` vocabulary cannot build a
position with an open `rebound-cast` choice at all.

Rebound's window opens at the caster's **next upkeep** (CR 702.88a): the spell
resolves, is exiled, and schedules a `next-upkeep` delayed trigger which
`fireDelayedTriggers` converts into the reflexive Cast/Decline trigger a whole
turn later. Every `BladeSetupStep` operates inside the position it is handed —
`cast`, `activate`, `resolve-top`, `etb-trigger`, the three combat steps — and
none of them advances the turn. `ScenarioSpec` cannot express it either:
`scenarioBuilder.ts` lists `reboundCastWindow` among the fields it explicitly
does **not** lower, so a hand-written spec cannot seed the window directly and
would be forbidden from doing so anyway (ADR 0070 §4 — a seeded position the
engine could never have produced).

Madness only became expressible in this PR because #2983 added a `discard`
setup step. Before it, Madness had no reachable blade position either, for a
different reason worth recording: `activate` refuses any ability whose cost
stops at a decision, and a discard cost opens `pendingActivation` even with a
single card in hand; while `declare-attackers` walks combat forward by
**passing** priority, and passing inside an open madness window IS the decline
(CR 702.35a) — it bins the card and the window is gone before the step returns.

**Evidence.** `convex/gre/ai/blade/types.ts` (`BladeSetupStep`, the full union);
`convex/gre/ai/blade/combatSetup.ts:147-175` (the `declare-attackers` walk,
which passes until `DECLARE_BLOCKERS`); `convex/gre/scenarioBuilder.ts:1402`
(`reboundCastWindow: an open Rebound cast window — not lowered`);
`convex/gre/phases.ts:1913` (the `next-upkeep` delayed-trigger branch that is
the only producer of the window). Rebound's behaviour in this PR is covered by
`convex/gre/ai/__tests__/cast-window-choice.bot.test.ts` instead — five unit
tests over the generator and the search sandbox, including the fail-closed
no-legal-target case — which is real coverage but not a decision measurement.

**Why it may not deserve its own issue.** The fix is one more setup step
(`{ kind: "advance-to-upkeep", controller? }`, or a general `advance-turn`)
driving the real `advancePhase` the way the new `discard` step drives the real
`discardToGraveyard` — perhaps twenty lines. That smallness cuts both ways: it
is cheap enough to fold into whatever next touches the blade harness, and it
only pays off if a rebound-shaped decision is actually worth measuring. Today
exactly one card has rebound (Ephemerate, `mh1/white.ts`), and its decision —
recast a free blink or not — is close to the "strictly dominant" shape that
makes a weak blade entry. The argument for doing it anyway is that the gap is
about the HARNESS, not about Ephemerate: any future delayed-trigger mechanic
(suspend, any "at the beginning of your next upkeep" payoff) is equally
unmeasurable until a step can cross a turn boundary.
