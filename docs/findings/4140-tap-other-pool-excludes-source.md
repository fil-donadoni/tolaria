---
title: tapOtherFilter's candidate pool excludes the source, so a creature cannot pay "Tap two untapped creatures you control" with itself
discoveredBy: 4140
status: draft
confidence: high
---

**What is wrong.** `tapOtherCostCandidates` (`convex/gre/activation.ts`),
`tapOtherCandidates` (`convex/gre/activationCostPicks.ts`) and the bot's scan in
`convex/gre/moves.ts` all drop `c.id === sourceId`. For a creature whose cost
reads "Tap two untapped creatures you control" with no `{T}` (Root-Kin Ally,
Kirol Attentive First-Year, Supportive Parents), CR 302.6 binds only the
creature's own `{T}` symbol, so the source is a legal one of the two — the
engine refuses activations the rules allow (Root-Kin Ally with exactly one
other creature). A Vehicle that has become a creature (Honeymoon Hearse) is the
same case.

**Evidence.** Every hand-written `tapOtherFilter` card avoids it by
construction: the source has `{T}` (Hand of Justice), is not a creature
(Earthcraft, Hecatomb), or is not of the filtered type (Vodalian War Machine
is a Wall, not a Merfolk). Issue #4140 therefore makes the cost grammar REFUSE
the line when the source could pay with itself (`sourceCouldPayItself`,
`convex/oracle/grammar/shared/cost.ts`) rather than compile a definition the
engine plays wrong.

**Why it may not deserve its own issue.** It is defensible without the ticket
that found it (a rules gap with three corpus cards behind it), and it is the
last blocker for them: dropping the exclusion means a `includeSource`-style
field on `tapOtherFilter` plus the three scans above and the client picker
(`src/lib/tap-other-progress.ts`), after which `sourceCouldPayItself` is
deleted and the three creatures re-enter the grammar.
