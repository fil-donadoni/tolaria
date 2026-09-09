---
title: latentValue's noncreature floor hides a genuinely negative script, so Flash still gets cast
discoveredBy: 3292
status: draft
confidence: high
---

**What is wrong.** `latentValue` floors a non-creature's hand worth at
`base + manaValue`, so a card whose Effect Script is genuinely NEGATIVE never
reads as one. Issue #3292 corrected Flash's script from +120 to −40 and the
floor swallowed the whole correction: Flash's hand worth went 120 → ~46, not
120 → −40. Worse, the direction is wrong for the cast decision — a LOWER hand
worth makes casting the card marginally more attractive, because casting is what
gives the hand card up.

**Evidence.** `convex/gre/cardValue.ts` — `Math.max(fallback, bounded)`. Measured
on issue #3292's own reported position (Flash + Craw Wurm in hand, exactly two
lands so the {2}-reduced cost is unpayable), root-decision means for
`cast Flash` / `pass`: 164.1 / 137.1 before the fix, 164.0 / 130.6 after. It
converges AWAY with budget — 208/167 at 2000 iterations, 239/193 at 6000 — the
`valuation` signature, so the bot still casts Flash for nothing.

**Why it may not deserve its own issue.** The floor's stated rationale (issue
#1430: a card whose script the Op vocabulary cannot yet value fully must not
drop below its mana-value worth) is sound, and lifting it would re-price every
scripted noncreature at once. The narrower reading — the floor should apply to
an INCOMPLETE valuation, not to a script the vocabulary values completely and
negatively — needs the "is this script fully valued" signal the value model does
not currently carry. Worth pairing with issue #3293, which gives the
cheat-into-play shape its positive value and may move this position on its own.
