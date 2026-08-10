---
title: The two "no threat" activation blade entries survive every break they nominally guard
discoveredBy: 1920
status: draft
confidence: high
---

**What is wrong.** Two `tier: "must"` entries added by #1920 —
`activation timing: does not activate Iron-Shield Elf with no threat` and
`activation timing: does not crack Sylvan Safekeeper with no threat` — read like
guards on specific mechanisms but are not sensitive to any of them. They pass
under every deliberate break attempted:

| Break                                                                               | Result           |
| ----------------------------------------------------------------------------------- | ---------------- |
| Disable the #1890 item-1 rollout guardrail (`isDiscouragedRolloutMove` penalty)     | green, 5/5 seeds |
| Make activation costs free again in the leaf (drop `applyActivationCostsForSearch`) | green, 5/5 seeds |
| Both together                                                                       | green, 5/5 seeds |

The root prefers `pass` in both positions by a margin wider than any of those
mechanisms contributes, so the entries cannot discriminate them. An earlier draft
of the Elf entry's `note` asserted it was "what fails if that scoping is ever
loosened" — measurably false, and now corrected in the registry.

**Evidence.** `convex/gre/ai/blade/registry.ts`, the two entries named above,
budget `{ iterations: 200 }`, seeds `[0xb1ade, 1, 2, 3, 4]`. Breaks applied at
`convex/gre/search.ts` (the `ROLLOUT_GUARDRAIL_PENALTY` branch in
`selectRolloutMove`, and the `applyActivationCostsForSearch` call in
`applyMoveInSearch`'s `activate-ability` case). A variant of the Elf position
with an uncastable hand card (Craw Wurm instead of Grizzly Bears), removing the
"it had something better to do" confound, was also measured: still `pass` on 5/5
under both breaks.

They are not worthless — each is the paired negative control for a reactive
entry that IS discriminating (Elf reactive: red 5/5 pre-#1920, green 5/5 after),
and the pair is what shows the fix bought discrimination rather than a blanket
bias toward activating. But they are tripwires against a large future
mis-valuation, not proofs about the mechanisms their labels name.

**Why it may not deserve its own issue.** This is a property of two entries the
same PR added, already documented honestly in their own `note` fields, so a
reader is no longer misled — arguably the whole remedy. The general question
behind it is bigger and may be the real ticket: the blade harness has no way to
express "this entry is discriminating" as a machine-checked fact, so every
entry's discriminating-ness rests on a prose claim in `note` that nothing
re-verifies as the engine changes. A `bun run test:blade --mutate` mode that
re-ran `must` entries against a set of seeded engine perturbations and reported
which entries never go red would catch this class automatically; that is a real
piece of work and squarely outside #1920.
