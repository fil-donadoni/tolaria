---
title: No gate catches a remove-then-refer Op ordering, now that it fails silently
discoveredBy: 2287
status: triaged
issue: 2988
confidence: high
---

**What is wrong.** Issue #2287 turned "name the controller of an object an
earlier Op already removed" from a raise into a skip. That was the right trade
— a raise inside a Convex mutation is a stuck game — but it also removed the
only thing that detected the mistake. The bug that motivated the issue,
Undermine, was found _because_ it threw. The next one will simply have a clause
that never happens, on a card that passes every gate.

Nothing in the offline gate can see it:

- `convex/cards/__tests__/effectScripts.test.ts` validates schema, refs,
  vocabulary and JSON purity. It performs no ordering analysis.
- The generated smoke sweep never resolves **any** of the 22 catalogue uses:
  `convex/gre/effects/scenarioGenerator.ts:136-142` classifies
  `{ controllerOf }` as runtime-dependent, `analysePlayer` turns that into a
  slot skip, and `planSmokeTest` returns `{ kind: "skip" }` — so
  `effectScriptSmoke.test.ts` walks past the whole class.

**Evidence.** The census in PR #2978 read all 22 uses by hand and found exactly
one broken. That is the shape of the problem: a point-in-time human sweep is
the only thing standing between the catalogue and a silent clause, and it has
to be re-run by hand every time a card is added.

The check is mechanical. Within one `effects[]`, recursing into `if` / `forEach`
/ `modes[]` and ability-level scripts, flag any `{ controllerOf: { target: n } }`
— including nested under `{ opponentOf: … }` — that appears after an Op which
removes slot `n` from its zone (`counter`, `destroy`, `exile`, `sacrifice`,
`moveZone`, `moveSpellFromStack`). It is roughly the walk `checkOpListRefs`
(`convex/gre/effects/validate.ts:5516`) already performs for dangling bindings,
with a per-slot "has been removed" set instead of a binding environment.
CLAUDE.md's own rule points the same way: a rule that CAN be enforced
mechanically belongs in a script the gate runs.

**Narrower than first written.** A re-check found that the sibling hazards are
already handled: `manaValue` and every object ref resolve through
`resolveObjectRef`, which re-checks battlefield presence and degrades to a CR
608.2b skip, and `bindSnapshot` gained the same guard in #2978. The
controller-of ref was the outlier because it read the raw slot and then did a
throwing lookup. So the check is not "catch a family of engine crashes" — it is
"surface, at authoring time, a clause the interpreter will silently decline to
perform". It must also stay clear of the CORRECT idioms: a snapshot bound
before the removal, an Op that merely acts on a departed object, and the blink
pattern (exile with a binding, later return the bound object) are all fine.

**Triaged → #2988.**
