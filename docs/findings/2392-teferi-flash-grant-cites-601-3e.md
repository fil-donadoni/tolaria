---
title: The player-scoped flash grant is documented as CR 601.3e, which is a different rule
discoveredBy: 2392
status: draft
confidence: high
---

**What is wrong.** Several sites document the Teferi-style per-player "you may
cast spells as though they had flash" grant as CR 601.3e. Printed, 601.3e is
about _alternative sets of characteristics_ considered when deciding whether a
card is legal to cast (Garruk's Horde, Melek) — nothing to do with flash. The
rule that actually covers an effect letting a player cast spells with certain
qualities as though they had flash is CR 601.3b. This is the
resolvable-but-wrong class `cr:lint` cannot see: the ids all exist, so the
scanner is satisfied, and only reading the rule catches it.

**Evidence.** `convex/cards/castRestrictions.ts:147` ("CR 601.3e — `true` when
`casterId` holds a `castTimingFlashGrant` (Teferi's +1)"), the same claim on the
`castTimingFlashGrants` field doc a few lines below, and
`convex/cards/mechanicsRegistry.ts:2729` (`cr: "601.3e"` on the
`grantCastTiming` row, plus its note). Two further registry rows at 2750/2757
use "601.3e / 117.6" for _cast permission from exile/graveyard_, which is a
different claim again and may or may not be right.

**Why it may not deserve its own issue.** It is comments and one registry `cr`
field — no behaviour depends on it, and #2392 deliberately did not relitigate
it (its own new row cites 601.3b). But it is ~6 sites of a citation that reads
authoritative and is not, in the module that is the single cast-legality
authority, so a one-pass correction is cheap and the alternative is that the
next author copies it a seventh time. It would pair naturally with any future
`cr:lint` widening beyond 701/702 titles.
