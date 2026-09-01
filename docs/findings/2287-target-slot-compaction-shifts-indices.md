---
title: targetLegalityGate compacts item.targets, shifting every later slot index
discoveredBy: 2287
status: triaged
issue: 2985
confidence: high
---

**What is wrong.** After a PARTIAL fizzle, the surviving targets are re-indexed,
so every `{ target: n }` in the resolving script silently names a different
object than the one announced in that slot — or nothing at all. The DSL reads
slots positionally and raw, so there is no layer between the shift and the Op
that acts on it.

**Evidence.** `convex/gre/state.ts:5833` —

```ts
const legal = targets.filter((t) => isTargetStillLegal(state, t, item));
if (legal.length === 0) return "fizzle";
if (legal.length !== targets.length) item.targets = legal; // ← compacts
```

`filter` closes the gap. Every consumer indexes the array directly:
`resolveTargetRef` / `resolveObjectRef` / `resolvePlayerRef` all do
`ctx.targets[ref.target]` (`convex/gre/effects/interpreter.ts`), as does every
imperative `resolve()` that reads `ctx.targets[1]`.

Concretely, a two-target script `[{ dealDamage, target: { target: 0 } },
{ destroy, target: { target: 1 } }]` whose slot-0 creature is removed in
response: slot 1 survives, `item.targets` becomes `[slot1]`, and the damage Op
now reads index 0 — **the object that was announced for the destroy**. It takes
the damage AND is destroyed; the correct outcome is that the damage clause is
skipped (CR 608.2b) and only the destroy happens.

**Every** multi-target script in the catalogue was then scanned for a card
where slot 0 and slot 1 fall under DIFFERENT Ops — the only shape where the
shift is observable. There are none: Plague Spores, Fumarole, Reckless Spite,
Restock, Garruk's +1, Tribute to Hunger's up-to-three destroys and the rest all
apply the SAME Op to each slot, so a shifted reference acts on an object that
was going to be acted on anyway. Oko −5 mutates via `gainControl`, which never
removes the object. So this is latent, not observed — a trap for the next
heterogeneous multi-target card, sprung silently.

**Adjacent, same lines.** The pruning cites `CR 608.2c`, which is about
following a spell's instructions in the order written and says nothing about
illegal targets. The governing rule is CR 608.2b, and it does not ask for
removal at all: illegal targets "won't be affected by parts of a resolving
spell's effect for which they're illegal" — the target keeps its position and
the parts naming it are skipped. Its own Plague Spores example turns on the
target staying put. So the compaction is a mismodelling, not just a shifted
index.

**Triaged → #2985** (P0). The fix is not free — keeping the position occupied
touches every positional consumer including the serializer, and the alternative
of tagging targets with their announced index changes the wire shape of
`StackItem.targets` — which is why the issue asks for a census before a choice.
