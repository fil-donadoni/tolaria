---
title: layers2to5 calls a StaticEffect condition with its arguments reversed
discoveredBy: 3726
status: draft
confidence: high
---

**What is wrong.** `StaticEffect`'s source-level CR 611.2c gate is declared
`condition(source, state, ctx)` in `convex/cards/types.ts` — that is the order
on `StaticPTBuff.condition` and `StaticKeywordGrant.condition`, and the order
`convex/gre/layer6.ts` and `convex/gre/layers.ts` both call it with. The
layers-2-to-5 resolver calls it `condition(state, source)`.

**Evidence.** `convex/gre/layers2to5.ts:941`:

```ts
const condition = (
    effect as {
        condition?: (s: LayerStateView, src: PermanentView) => boolean;
    }
).condition;
if (condition && !condition(state, source)) return undefined;
```

The local `as` cast declares the reversed signature too, so `tsc` is satisfied
and nothing reds. It is dead code today: only `pt-buff` (layer 7) and
`keyword-grant` (layer 6) declare a `condition`, and neither is a layer-2-to-5
kind, so the branch is never taken.

**What it would change.** The day any layer-2-to-5 kind gains a `condition` —
`control-change`, `type-add`, `subtype-set`, `color-grant` — the gate is
evaluated with a `LayerStateView` where a `PermanentView` is expected and vice
versa. It does not throw; it silently reads the wrong object, so the effect is
gated on nonsense. The comment directly above the call says it reads "the same
`condition` layer 6 and layer 7 read", which is what makes this hard to spot.

**Why it surfaced now.** Issue #3726 added a SECOND reader of the same field
(`convex/gre/lingeringStatics.ts`, which uses the declared order). A lingering
effect must be the live answer frozen, so the two readers disagreeing is no
longer a dormant inconsistency but a divergence between the effect while its
source is on the battlefield and the effect after it leaves.

**Why it may not deserve its own issue.** One line, no behaviour change today,
and it is arguably a line on whichever ticket first gives a layer-2-to-5 kind a
`condition`. The counter-argument is that the fix is one line and the bug is
invisible until it is expensive.
