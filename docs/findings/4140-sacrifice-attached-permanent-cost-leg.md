---
title: no activation-cost leg sacrifices the permanent the source is attached to ("Sacrifice enchanted creature")
discoveredBy: 4140
status: draft
confidence: high
---

**What is wrong.** `ActivatedAbility["cost"]` has `sacrifice` (the source) and
`sacrificeFilter` (a chosen permanent matching a static `PermanentFilter`), but
nothing for "the permanent this Aura is attached to": `PermanentFilter` has no
attachment field and the pick is not a choice at all. The cost grammar
therefore cannot lower "Sacrifice enchanted creature" (Bloodfire Infusion,
Betrothed of Fire), and issue #4140's second span stays a gap.

**Evidence.** `convex/cards/types.ts` cost block (only
`manaEqualToEnchantedCreatureCost` reads `attachedTo`); the effect side is
ready — `EffectSacrificedValue` reads `power` off the
`additionalSacrificeSnapshot`, which is what "the sacrificed creature's power"
lowers to. Bloodfire Infusion is otherwise expressible once the cost leg
exists.

**Why it may not deserve its own issue.** It is a new cost leg across the
payment sites (announce gate, commit, bot enumerator, client affordance —
"cost-payment consumers span client+server"), so it wants its own issue with a
full-path test rather than a line on #4140; two corpus cards behind it today.
