---
title: Announcement-time cast legality and cost reads still resolve against the zone owner, not the caster
discoveredBy: 3000
status: draft
confidence: high
---

**What is wrong.** Issue #3000 stamped the caster onto `controllerId` at the
cast COMMIT (`removeFromZone`). Two announcement-time reads happen BEFORE that
commit, while the card still sits in the zone owner's zone, and both resolve
"you"/"your" against the card object's `controllerId` — which for a
cross-player cast permission is the OWNER:

- **CR 117.1a timing restriction.** `passesCastPhaseRestriction` evaluates a
  card's `castTurnRestriction` ("cast this spell only during your turn" /
  "only during an opponent's turn") against `card.controllerId`, so a card cast
  from an opponent's zone is gated on the OWNER's turn — exactly inverted for
  the two "only during an opponent's turn" subjects. Four shipped cards declare
  it (`ice/red.ts`, `lea/blue.ts` ×2, `leg/blue.ts`).
- **Cost reduction.** `getCostModifiers`' SPELL arm resolves
  `selfCostReduction` ("costs {1} less to cast for each X you control", 14
  shipped cards) against `card.controllerId`, so the discount counts the
  OWNER's board. The function already receives `activatorId` and already uses
  it in its ABILITY arm — the spell arm does not thread it.

Not reachable through Dauthi Voidwalker (its grant waives the mana cost
entirely, so no cost is computed, and none of the four restricted cards is a
likely void-exile subject); reachable through any pay-to-cast cross-player
grant.

**Evidence.** `convex/gre/rules.ts` — `passesCastPhaseRestriction` reads
`card.controllerId`; `convex/gre/state.ts` — `getCostModifiers`' spell arm does
the same while its ability arm at the next branch uses `activatorId`. Both are
called from the announcement path, before `removeFromZone`.

**Why it is not fixed in issue #3000.** That issue's own scope line excludes
it: "the behaviour of the individual cast-permission grants themselves (which
cards may be cast, cost reduction, timing windows) — only the controller of the
resulting spell/permanent is in scope." The fix shape is different too: these
need the PROSPECTIVE controller threaded into a predicate, not a field stamped
on an object (the object is not the caster's yet, and stamping early would leave
a card in the owner's zone claiming someone else as its controller).

**Why it may not deserve its own issue.** One ticket covering "announcement-time
reads take the caster, not the zone owner" is defensible without either card
that surfaced it, and it is small. Two separate tickets would not be.
