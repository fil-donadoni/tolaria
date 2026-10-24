---
title: The Bot's turn-face-up choice ignores the face-up body and the face-up trigger's sign
discoveredBy: 5227
status: draft
confidence: medium
---

**What is wrong.** Once the morph turn-up is affordable, the play Bot often
picks it whether or not it helps. Positions measured at 400 iterations on the
blade runner's default seed while building the issue #5227 blade entry:

- A face-down Skinthinner and five Swamps, no opponent creature, a Scathe
  Zombies in hand: the Bot turns Skinthinner up (2/2 → 2/1, five mana, its
  "destroy target nonblack creature" trigger has no legal target) rather than
  casting the Zombies.
- A face-down Aphetto Exterminator, a Grizzly Bears and four Swamps, no
  opponent creature: the Bot turns the Exterminator up even though its
  mandatory "target creature gets -3/-3" can only hit its own Bears or the
  Exterminator itself. The search does surface the trigger's `submit-target`
  for both candidates (checked by applying the move through
  `applyMoveInSearch`), so this is valuation or rollout noise, not
  reachability. With the face-up event withheld, the same position does NOT
  turn up, which points at noise between close candidates rather than a
  steady preference.

**Evidence.** Reproduce with `runBladeScenario` on those two specs (cards by
name, `faceDown: true` on the morph). The search side is
`turnFaceUpInSearch` + `checkStateBasedActionsAfterSpecialAction`
(`convex/gre/search.ts`); the valuation is `evaluate.ts`'s card-quality terms
for a face-down permanent against its face-up definition.

**Why it may not deserve its own issue.** It may be one instance of the
general "an action whose outcome is empty or negative ties with pass" class
that `convex/gre/ai/beneficence.ts` already targets. If a Verdict pair
(self-harming turn-up → hold; empty turn-up with a better cast → cast) fits
under the existing weights, it belongs as blade entries under that work, not
as a new mechanism.
