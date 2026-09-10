---
title: The forEach construct's "determined once" rule is cited as CR 608.2i, which is the look-back-in-time rule
discoveredBy: 3222
status: draft
confidence: high
---

**What is wrong.** The `forEach` selector's freeze semantics — "the set is
determined ONCE, at construct entry" — are attributed to CR 608.2i in both the
Mechanics Registry row and the type documentation. CR 608.2i is the LOOK-BACK-IN-TIME
rule (an effect asking about a previous game state, whose objects need not still be in
their zone or still meet the criteria). The rule that actually says information is
determined only once, when the effect is applied, is CR 608.2h. Both ids resolve, so
`bun run cr:lint` cannot see it: the scan asks only whether an id exists, and 608.2i is
outside the 701/702 keyword-title scan too.

**Evidence.** `convex/cards/mechanicsRegistry.ts:2995` (`cr: "608.2i"` on the `forEach`
row) and its note in the same row; `convex/cards/types.ts:12265` (the
`EffectForEachSelector` doc comment, "CR 608.2i — information from the game is
determined only once, as the effect is applied" — the wording is 608.2h's, verbatim,
under 608.2i's number). Printed: `bun run cr 608.2h` vs `bun run cr 608.2i`. The same
misattribution was about to be copied into this issue's battle cry comments and was
corrected there against the printed text.

**Why it may not deserve its own issue.** Nothing behaves differently — the
implementation is right and only the citation is wrong, which makes it a one-line
correction in two files rather than a ticket. It matters because the registry row is
the place a future author copies from, so the wrong number propagates; a grep for
`608.2i` across the repo would say how far it already has, and if that count is one or
two it is a line on an existing docs pass, not a ticket of its own.
