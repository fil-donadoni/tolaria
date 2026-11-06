---
title: A hand-discarding mana source cannot fund a cast while the hand holds another card
discoveredBy: 8297
status: draft
confidence: medium
---

**What is wrong.** With Lion's Eye Diamond, two Plains and a hand of Serra Angel
plus Grizzly Bears, paying for the Angel through the Diamond is legal: the
Diamond's mana ability is activated with the spell on the stack (CR 601.2g), so
it discards only the Bears. `getLegalActions` does not offer the cast, and
`announceCast`'s `assertLegalAction` refuses it. Floating the mana first is no
way round it, because that discards the Angel too. So a human can only make this
play when the lands alone clear the gate.

**Evidence.** `handDiscardFree` is set in `buildManaSourceUnits`
(`convex/gre/rules.ts`) only when `handDiscardCostsNothing` holds. The test
`neither reaches it while the discard would cost another card` in
`convex/__tests__/handDiscardManaCastPath.bot.test.ts` pins that refusal for the
Bot, and the census answer is shared with the human gate.

**Why it may not deserve its own issue.** Lion's Eye Diamond is the only shipped
card with this cost, and discarding a live hand for mana is rarely right outside
a combo deck. Widening the gate is also not free: `genericManaShortfall`,
`maxAffordableX` and the Phyrexian split read the same census, so counting the
Diamond there without the planner following would lower a delve's forced exile
on a board whose plan then returns null.
