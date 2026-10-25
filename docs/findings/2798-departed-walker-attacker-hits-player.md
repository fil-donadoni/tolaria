---
title: An attacker whose planeswalker left the battlefield deals combat damage to the player
discoveredBy: 2798
status: draft
confidence: high
---

**What is wrong.** CR 506.4c: removing the planeswalker an attacker is
attacking leaves the attacker "not attacking any player, planeswalker, or
battle"; CR 510.1b: "If it isn't currently attacking anything (if, for example,
it was attacking a planeswalker that has left the battlefield), it assigns no
combat damage." The engine instead re-aims it at the defending player.

**Evidence.** `convex/gre/phases.ts` (`pwTargetId` / `pwTargetCard` in the
combat damage step): "Absence (or a planeswalker that has since left) means the
attacker is attacking the defending player." `attackTargetExcessSink`
(`convex/gre/damageAssignment.ts`) does the same for a trampler's excess. So a
Bolt on the attacked walker after attacks turns an unblocked walker attack into
face damage.

**Why it may not deserve its own issue.** It needs instant-speed walker removal
between declare-attackers and damage. The Bot's combat predictor (issue #2798)
already prices that case as no damage (CR 510.1b), so the Bot and the engine
disagree only in that window.
