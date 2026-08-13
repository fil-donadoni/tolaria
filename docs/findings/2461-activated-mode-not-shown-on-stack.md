---
title: A modal ACTIVATED ability's announced mode never renders on the stack row
discoveredBy: 2461
status: draft
confidence: medium
---

**What is wrong.** `getStackModeLines` now feeds the stack row two mode lists —
a modal spell's `CardDefinition.modes` (issue #1274) and, since #2461, a modal
triggered ability's `TriggeredAbility.modes` (CR 603.3c). The third announcing
object, a modal ACTIVATED ability (`ActivatedAbility.modes`, issue #1341 —
Umezawa's Jitte's "Remove a charge counter from ~: Choose one — …"), still
returns `null`: its `chosenModeId` crosses the wire and drives resolution, but
neither player sees WHICH mode was announced while the ability sits on the
stack. Both players are entitled to that information before responding, exactly
as for the other two — CR 700.2c makes the announcement public.

**Evidence.** `src/lib/card-utils.ts:2513` selects the mode list from
`isSpellStackItem(item)` → `def.modes`, else `item.triggeredAbilityId` →
`def.triggeredAbilities[…].modes`, else `undefined`. An activated-ability stack
item carries `abilityId` (`convex/gre/state.ts` StackItem) and falls into that
last branch. The dispatch that consumes the mode at resolution exists and works
(`convex/gre/state.ts:5161-5166`), so this is a display gap only.

**Why it may not deserve its own issue.** The fix is three lines in one reducer
plus a wire test, so it is plausibly a line on an existing UI tracker rather
than a ticket of its own. It is also not purely mechanical: an ability granted
by another card reads its template from `grantTemplates` on the GRANTING card
(`grantedSourceCardId`), so a correct version has to resolve that indirection —
which is why #2461 did not widen the reducer opportunistically (the issue's
out-of-scope list rules out touching the activated-ability path beyond sharing
the mode machinery).
