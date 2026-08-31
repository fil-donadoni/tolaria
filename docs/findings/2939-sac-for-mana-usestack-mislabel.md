---
title: Three sacrifice-for-mana outlets are mana abilities under CR 605.1a but carry useStack true
discoveredBy: 2939
status: draft
confidence: high
---

**What is wrong.** `CR 605.1a` makes an activated ability a mana ability when
it needs no target, could add mana on resolution, is not a loyalty ability, and
neither its cost nor its effect moves a card to or from a library. Three
shipped sacrifice outlets satisfy every clause and are nonetheless declared
`useStack: true`:

- `Ashnod's Altar` — `convex/cards/sets/atq/colorless.ts` (`effects: [{ op: "addMana", … }]`)
- `Phyrexian Altar` — `convex/cards/sets/inv/colorless.ts`
- `Priest of Yawgmoth` — `convex/cards/sets/atq/black.ts`

So they go on the stack, can be responded to, and can be countered — none of
which a mana ability permits (CR 605.3a). The engine's own convention is
explicit: `.claude/rules/gre-development.md` says mana abilities use
`useStack: false`.

**Evidence.** Surfaced while widening the bot's activation-deferral rule
(issue #2939): `isDeferrableStackAbility` (`convex/gre/ai/abilityTiming.ts`)
excludes mana abilities by testing `useStack`, so these three walk straight
past that exclusion and the deferral rule would have held the bot's own mana
production out of its main phase. `spendsStandingPermanent` now excludes any
sacrifice ability whose script can `addMana`, which is correct on its own terms
(mana empties at the end of each step and phase, CR 500.5, so an outlet
deferred to the opponent's end step produces mana that is simply lost) and
stays correct after these definitions are fixed. Nothing in the bot depends on
the mislabel.

**Why it may not deserve its own issue.** The visible consequences are narrow:
a player can respond to Ashnod's Altar, which is wrong but rarely load-bearing,
and the auto-tapper's `hasNonManaActivatedAbility` reads these as dual-purpose
sources. Against that, it is three one-line definition changes with a clear CR
answer, and `useStack` is exactly the kind of flag that silently mis-teaches
every consumer that reads it — the bot rule above being the first. Worth
checking whether a catalogue-wide guard ("an ability whose script only adds
mana and takes no target must be `useStack: false`") is cheaper than finding
the next one by accident.
