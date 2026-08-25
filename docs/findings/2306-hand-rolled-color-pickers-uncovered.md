---
title: Four hand-rolled colour pickers never carry EffectMode.color, so they stay outside colorModePrior's coverage
discoveredBy: 2306
status: draft
confidence: medium
---

**What is wrong.** Issue #2306 fixed the Bot's arbitrary protection-colour pick
by threading `EffectMode.color` (`option.color` on the wire) through to a new
`colorModePrior` / `colorModeTiebreak` pair that scores a colour choice against
the opponent's observed colour footprint. That fix is scoped to cards built on
the shared `optionChoice` Op with `EffectMode.color` set — `protectionColorModes`
and `colorChoiceModes` (`convex/cards/abilities/`). Four cards call
`ctx.requestOptionChoice` directly with a hand-rolled options list that never
sets `color`, so they are structurally invisible to the new heuristic even
though their choice IS a colour pick in spirit.

**Evidence.** `convex/cards/abilities/chooseColor.ts:34-40`, `COLOR_OPTIONS`
— flags Kavu Chameleon, Alloy Golem, Fertile Ground, and Shyft as calling
`ctx.requestOptionChoice` with options built without the `color` tag
`optionPickCandidates`' `toCandidate` (`convex/gre/ai/choiceCandidates.ts`)
now reads. Their colour pick falls through to the flat `NEUTRAL_PRIOR`, same
as every colour choice before this issue.

**Why it may not deserve its own issue yet.** These four cards are a
different SHAPE of colour choice than protection-from-colour or "becomes the
colour of your choice" (chameleon/becomes-a-colour effects, a colour-fixing
land, a "name a colour" static-effect setup) — whether the SAME
opponent-evidence heuristic is even the right prior for them needs its own
grill (a land like Fertile Ground picking its own future colour is arguably
about the CASTER's future needs, not the opponent's threats, which is the
opposite orientation from protection). A blanket "thread `color` everywhere"
ticket risks conflating four genuinely different decisions under one label.
Worth a scoped audit of each of the four before cutting a ticket, rather than
assuming they all want `colorModePrior` unchanged.
