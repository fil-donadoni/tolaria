---
title: No check:ui runbook surface opens a zone pile with a castable/activatable card
discoveredBy: 2900
status: draft
confidence: medium
---

**What is wrong.** `bun run check:ui`'s axe pass never sees the eight zone-CTA
buttons (Exile Cast, Graveyard Flashback/Activate/Play land, library Cast/Play
land, Turn face up, Companion summon) because no runbook surface opens a zone
pile (Exile / Graveyard reveal dialog / library-top overlay) that actually
contains a card matching the relevant `legalActions` flag. That is why the
identity-v4 ivory-on-white regression (issues #2900/#3280) shipped invisibly —
the contrast defect lived in a class string axe never rendered, and both the
defect and its residual hover-delta half had to be caught by reading source
text instead.

**Evidence.** `docs/guides/ui-runbooks.md`'s click sequences walk hand/battlefield/
stack surfaces; none seed a debug scenario with e.g. a flashback-capable card in
the graveyard or an exile-castable card, then open that zone's reveal dialog.

**Why it may not deserve its own issue yet.** Fixing this needs a debug-scenario
preset that puts a matching card in each zone plus a runbook step opening each
dialog — real scope, not a one-line addition, and orthogonal to the class-string
fixes themselves. The mitigation that shipped instead is a source-text sweep in
`src/__tests__/design-tokens.test.ts` (it reads every `className=` and the
recipe module's own literals), which catches the class-string class of defect
without a browser. Worth ticketing if a zone-CTA regression that only a RENDER
can catch — clipping, z-order, a tap target under the fold — ships invisibly.
