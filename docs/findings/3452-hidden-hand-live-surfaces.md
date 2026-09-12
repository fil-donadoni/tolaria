---
title: Three live-game surfaces cannot hold a hand card of unknown identity
discoveredBy: 3452
status: draft
confidence: high
---

**What is wrong.** Issue #3452 gave `ScenarioSpec` a `hiddenHand` per-seat count
that rebuilds as opaque placeholders (`PLACEHOLDER_CARD_ID`). That is safe in a
position rebuilt to be EVALUATED — the verdict quiz, `evalPairsOf`, a blade run
— and unsafe in one a client renders and the turn structure plays out, so the
two loaders that persist a scenario into a real game refuse it
(`assertLoadableIntoLiveGame`, `convex/gre/scenarioBuilder.ts`). This is what it
would take to lift that refusal.

**Evidence.** Three surfaces each need an identity a placeholder does not have:

- `src/hooks/useHandCardCommit.tsx:703` calls bare
  `getDefinition(cardInstance.card.id)` at RENDER time, which throws on an id
  the registry cannot resolve — so `hiddenHand.me` blanks the viewer's board on
  mount, with no ErrorBoundary above it. This is the crash class issue #2347
  fixed for Manual Board hands, by splitting the component so the GRE hooks are
  never reached; the same split is what would fix it here.
- `tryEnqueueCleanupDiscard` (`convex/gre/phases.ts:2447`) computes its excess
  over `active.hand.length`, placeholders included, so a staged hand over the
  maximum (CR 514.1) owes a discard whose candidate list cannot name the card
  that has to go — the client hand picker renders what it can identify and the
  Bot's candidate reader (`src/lib/ai/bot-view.ts`) drops what it cannot, so the
  submission is short, the mutation refuses, and the seat cannot pass the turn.
  Fixing it by excluding placeholders from the count would ALSO change the
  search, where a blind opponent's hand is placeholders every simulation — a
  bot behaviour change, so it owes a `must` blade entry rather than a quiet edit.
- A hand-zone pick or reveal (CR 401.4 — Thoughtseize, Mind Warp, `reveal-hand`)
  puts the slot in front of a chooser whose filters read characteristics the
  card has none of: with `types: []` a placeholder passes an
  `excludeType: "Land"` filter and is offered as a legal pick. If one is then
  discarded it lands in a PUBLIC zone, where
  `src/components/board/graveyard-card-picker.tsx:37` calls bare
  `getDefinition(card.card.id).name` and throws.

**Why it may not deserve its own issue.** Nothing needs it today: the field
exists for PRD #3397's capture path, which only evaluates the rebuilt position,
and the refusal names the reason at the point of use. It earns a ticket the day
someone wants to STAGE an opponent's unknown hand in a live debug game — a
reasonable want, and the first two bullets are most of the work.
