---
title: "Do this only once each turn" (CR 603.2h) also mis-fires on The Sensational She-Hulk's damage redirect
discoveredBy: 8171
status: draft
confidence: high
---

**What is wrong.** The Sensational She-Hulk (back face of Jennifer Walters,
`convex/cards/sets/msh/multicolor.cards.ts`, `the-sensational-she-hulk-redirect`)
reads "Whenever a creature you control is dealt damage, you may have The
Sensational She-Hulk deal that much damage to any target. Do this only once
each turn." CR 603.2h: "This ability triggers only if its source's controller
has not yet taken the indicated action that turn." The shipped cap is
`maxTriggersPerTurn: 1`, a trigger count, so (1) declining the "may" spends the
turn, (2) a trigger that fizzles on an illegal target spends it, and (3)
combat damage dealt to several creatures at once triggers only once, so the
controller cannot pick the largest amount.

**Evidence.** Same class as `docs/findings/2761-ancient-cornucopia-cr603-2h.md`;
`bun run cr 603.2h` prints the rule. Enforcement point:
`convex/gre/triggers.ts` (`triggerCapReached` / `noteTriggerFired`).

**Why it may not deserve its own issue.** Two shipped cards now share the
class, and She-Hulk's case (3) is reachable without a deliberately-bad play,
unlike Cornucopia's. That tilts it toward one general "action taken this turn"
primitive in `convex/gre/**`, ticketed once for both cards after a grill on
the shape (per-source flag set when the may-effect resolves to yes).
