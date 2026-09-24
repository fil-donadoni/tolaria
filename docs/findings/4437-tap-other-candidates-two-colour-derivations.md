---
title: Tap-other cost candidates are computed twice with different colour derivations
discoveredBy: 4437
status: draft
confidence: high
---

**What is wrong.** The announcement gate builds its tap-other candidate view
with the static-effect context's colours; the payment picker builds the same
list from the layered permanent view. The doc comment on the gate admits the
"different colour derivation"; the picker's comment still points to a `game.ts`
copy that no longer exists.

**Evidence.** `convex/gre/activation.ts` `tapOtherCostCandidates` vs
`convex/gre/activationCostPicks.ts` `tapOtherCandidates` (2026-09-23 audit,
lines ~285 and ~111).

**Why it may not deserve its own issue.** Nobody has shown a permanent whose
two colour views disagree on a shipped tap-other cost (Crew is colourless;
Hand of Justice taps white creatures). Unifying on the layered view may change
behaviour if such a permanent exists, so it needs a proof test first. Left out
of PRD (c) #4437 on purpose (behaviour-preserving pass); a one-issue fix with a
proof test when a card surfaces it.
