---
title: untapStep resume re-collects untap restrictions, so a cursor can land on the wrong source
discoveredBy: 4561
status: draft
confidence: medium
---

**What is wrong.** `untapStep` resumes after an `untap-pick` prompt by calling
`collectUntapRestrictions` again and indexing the new list with the stored
cursor. When a restriction's source stops contributing mid-step (Winter Orb is
gated on "as long as this artifact is untapped", CR 611.3a, and the Orb untaps
in the same step), the list shifts and the cursor points at the wrong entry.

**Evidence.** `convex/gre/phases.ts` (`collectUntapRestrictions`, `untapStep`
resume). Active player has a tapped Winter Orb A, the opponent an untapped
Winter Orb B: the first pass collects only B (cursor 1); A then untaps, the
resume sees [A, B], index 1 is B again, B prompts a second time and two lands
untap. CR 502.3 untaps everything at once, so only B's cap should apply.

**Why it may not deserve its own issue.** Needs two gated sources at once. The
base engine already stacks one prompt per Orb, so the total is no worse than
before. A fix is to snapshot the restriction ids on first entry; worth a ticket
only if a second gated untap lock ships.
