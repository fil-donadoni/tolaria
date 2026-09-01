---
title: A permanent returned by "return it… It's an enchantment" announces its entry as a creature, so other ETB triggers see a creature enter
discoveredBy: 2084
status: draft
confidence: medium
---

**What is wrong.** Enduring Innocence's dies trigger is three sequential Ops:
`moveZone` returns the card, then `setCardTypes ["Enchantment"]` strips Creature.
`emitPermanentEntered` fires inside the `moveZone`, i.e. **before** the type set,
so the `PERMANENT_ENTERED` event carries `types: ["Enchantment", "Creature"]` and
`power: 2`. Every "whenever a creature enters" watcher on the board therefore
fires off a permanent that — per the card's own reminder text — is not a
creature.

**Evidence.** Two Enduring Innocences on one battlefield: kill A, let its return
resolve, and **B draws a card** (B's trigger is "whenever one or more other
creatures you control with power 2 or less enter"). Same for Soul Warden and any
other ETB creature watcher. Ops at `convex/cards/sets/dsk/white.ts:76-92`; the
emit is inside `returnToBattlefield` (`convex/gre/state.ts`), reached from
`moveZone`'s reanimation branch (`convex/gre/effects/interpreter.ts:2965-2985`).

**What the CR says, and doesn't.** CR 603.6a checks ETB triggers at the moment
the event puts the permanent onto the battlefield; CR 611.2c says the continuous
effect's affected set is fixed when the effect begins, which is during the same
resolution. Neither text settles whether the type set is already applying at the
instant the entry event is checked. The four official rulings (Scryfall, fetched
2026-09-01) cover the subtypes, the nontoken copy and the token copy — none
addresses the entry announcement. The rulings' phrasing _"it will return to the
battlefield **as an enchantment**"_ leans toward "already an enchantment when it
enters", which is the opposite of what ships.

**Why it may not deserve its own issue.** If the strict instruction-order
reading is right (the effect begins after the return, CR 608.2), the shipped
behaviour is correct and there is nothing to fix. It is also not expressible at
the call site either way — making the permanent enter already-typed needs the
type applied _as_ it enters (a replacement-shaped seam, like
`stampBackFaceForEntry` does for transform), not a third Op after it. So this is
a rules call first and an engine change only if the call goes the other way.
Worth settling before the other four Endurings copy the template, and before a
general "return it… It's a [type]" Op shape is generalized at ADR 0082 / PRD
#2064.
