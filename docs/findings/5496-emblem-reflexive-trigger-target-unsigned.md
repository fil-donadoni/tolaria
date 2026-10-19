---
title: Emblem and reflexive trigger targets carry no announcement sign
discoveredBy: 5496
status: draft
confidence: medium
---

**What is wrong.** Issue #5496 taught the Bot to sign a raised trigger target
(`raisedTriggerSlotSigner`, `convex/gre/ai/beneficence.ts`) by reading the
trigger's Effect Script through `findTriggeredAbility(item,
item.triggeredAbilityId)`. Two trigger shapes never resolve there, so their
`submit-target` answers read as "no opinion" and are still ranked only by
`resolvedMarginDelta` plus rollout noise:

- **Emblem triggers.** The stack item's `card.id` is the emblem id
  (`buildEmblemTriggerItem`, `convex/gre/triggers.ts`), so the card-registry
  lookup misses. Chandra's −7 emblem ("5 damage to any target") is the live
  case: the Bot can aim it at itself.
- **Reflexive / delayed triggers.** They carry no `triggeredAbilityId`; their
  requirement rides on `inlineTargetRequirement` and their body sits on
  `item.delayedEffects`.

**Evidence.** `raisedTriggerSlotSigner` returns `undefined` when
`item.triggeredAbilityId` is absent or `findTriggeredAbility` returns nothing.
Fail-open by design (the module's header: a wrong sign costs more than a
missing one).

**Why it may not deserve its own issue.** Damage and life loss show up in the
margin, and the margin term already ranks those siblings once `submit-target`
reaches the tie-break. Only effects the margin can't see (discard, a gift
aura) still lose. If no shipped emblem or reflexive trigger has such an
effect, this belongs as a line on the Bot programme tracker, not a ticket. The
fix is two fallbacks in the signer: the emblem registry by
`item.emblemSourceId`, and `item.delayedEffects` when
`inlineTargetRequirement` is set.
