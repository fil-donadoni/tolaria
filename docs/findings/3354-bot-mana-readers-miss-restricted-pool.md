---
title: The Bot's mana accounting reads `manaPool` only, so every restricted or rider-tagged unit is invisible to it
discoveredBy: 3354
status: draft
confidence: high
---

**What is wrong.** The play Bot decides what it can afford from
`player.manaPool` alone. Mana in the parallel `restrictedMana` pool — Mishra's
Workshop, Delighted Halfling, Adarkar Unicorn, and now Arena of Glory's
bare-rider unit (CR 106.6, issue #3354) — is counted as zero.

**Evidence.**

- `convex/gre/moves.ts:836-842` — `planManaPayment` seeds its `PlanSource` list
  from `player.manaPool` only, so restricted mana funds no enumerated cast or
  activation.
- `convex/gre/evaluate.ts:305-309` — `availableManaFor` sums `manaPool` only,
  so `terms.mana` under-reports and `hasCastableInstant` under-answers.
- `convex/gre/heldInteraction.ts:54-68` — same sum, same effect on the
  hold-up-a-trick line.
- `convex/gre/applyMove.ts:981` — `applyTapPlan` credits no mana at all
  (deliberate: the probe marks sources tapped instead), so the search cannot
  VALUE a rider it never sees produced.

**Why it is not a freeze.** Every one of these fails CLOSED: the bot
under-counts, so it declines a play it could have made and never submits one
the server refuses. `enumerateMoves` and `assertLegalAction` both go through
`rules.ts`, which DOES fold eligible restricted mana in (`convex/gre/rules.ts:2193`),
so nothing can desync.

**Why it may not deserve its own issue.** Reaching it needs the bot to FLOAT
restricted mana, and the auto-tap planner excludes every restricted source
from its candidate set by construction (`buildAutoTapSources` +
`getManaTapOptionRestriction`), Arena of Glory doubly so
(`manaTapOptionSpendsUnplannedResource`, issue #3214 — exerting spends the
source's next untap step, a stored resource the planner must not spend
unbidden). So the bot has no way to produce this mana today, and this is a
latent gap that opens the day one is given to it — a line on the bot roadmap
(#1892) rather than a ticket, unless a shipped restricted source ever becomes
auto-tappable.
