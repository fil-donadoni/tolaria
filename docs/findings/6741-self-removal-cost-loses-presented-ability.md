---
title: An activated ability whose cost removes its own source resolves nothing when the source presents a borrowed identity (copy or full text)
discoveredBy: 6741
status: draft
confidence: high
---

**What is wrong.** When an ability's cost takes its own source off the
battlefield ("Sacrifice this creature: …", Mogg Fanatic), the cost is paid
through `removePermanentTo` BEFORE the stack item is built from the card. The
departure funnel reverts the source's borrowed identity on the way out
(`revertCopy`, which now also withdraws a CR 612.6 full-text effect), so the
stack item is built from the PRINTED card. At resolution, the ability is looked
up on the item's `card.id` and is not found, so the item pops having done
nothing. The player paid the sacrifice for no effect.

**Evidence.** `convex/game.ts` pays the self-removal cost (around line 5199)
before `buildActivatedAbilityStackItem(card)` (around line 5270). The
resolution lookup is in `convex/gre/state.ts` (around line 3014). Reproduced in
review for issue #6741: a Clone that copied Mogg Fanatic, and the full-text
Shapeshifter fixture showing Mogg Fanatic, both sacrificed to target p2, and p2
stayed at 20 life.

**Why it may not deserve its own issue.** It predates the full-text effect: the
copy case is already live. The fix belongs to the activation seam, not to
either identity mechanic. Snapshot the item before paying self-removal costs,
or record the ability's definition id on the item. One issue covers both.
