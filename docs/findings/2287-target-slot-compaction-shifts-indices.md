---
title: targetLegalityGate compacts item.targets, shifting every later slot index
discoveredBy: 2287
status: draft
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

Shipped multi-target cards were checked: Oko, Thief of Crowns −5
(`convex/cards/sets/eld/multicolor.ts`) degrades to a double no-op rather than
acting wrongly, and Plague Spores / Barrin's Spite name both slots in Ops that
are themselves skipped. So this is currently latent, not observed.

**Why it may not deserve its own issue.** No shipped card is known to produce
the wrong-object outcome today, and the fix is not free: keeping the array
sparse (`null` in the fizzled slot) touches every positional consumer including
the serializer, while the alternative — tagging targets with their announced
index — changes the wire shape of `StackItem.targets`. It may be better folded
into whichever ticket next adds a multi-target script whose Ops act on
different slots, where the correctness is observable rather than argued.
