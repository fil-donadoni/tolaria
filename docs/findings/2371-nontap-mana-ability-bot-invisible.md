---
title: Non-tap (useStack:false, no cost.tap/sacrifice) mana abilities are invisible to the bot
discoveredBy: 2371
status: draft
confidence: medium
---

**What is wrong.** Any `useStack: false` mana ability whose `cost` has
neither `tap` nor `sacrifice` (Farrelite Priest's `"{1}: Add {W}."`, fem/white.ts;
now also Urza, Lord High Artificer's `tapOtherFilter`-only `"Tap an untapped
artifact you control: Add {U}."`, mh1/blue.ts, issue #2371) is structurally
unreachable by the bot on two independent paths:

1. **The bot's macro-move enumerator explicitly skips it.**
   `convex/gre/moves.ts` `enumerateAbilityMoves` (~line 1038-1039):

    ```
    // Only abilities that use the stack are macro-moves here; mana abilities
    // are funded on demand by the cast planner, never activated standalone.
    if (!ability.useStack) continue;
    ```

    Every `useStack: false` ability is excluded from ever being offered as its
    own bot `Move`, regardless of cost shape.

2. **The auto-tap payment planner ALSO excludes it, by design and by cost
   shape.** `planManaPayment` (`gre/moves.ts:318`) walks
   `getProducibleManaOptions` (`gre/rules.ts:1068`), which calls
   `getManaTapOptionsDetailed(card, ..., { requireTap: true })`
   (`gre/constants.ts:1170`) — a gate that only recognizes `ability.cost.tap`
   (with `cost.sacrifice` also excluded there deliberately: "the auto-tap
   planner only ever taps for mana — it must never auto-commit a
   sacrifice-only source"). A `cost.mana`-only or `cost.tapOtherFilter`-only
   ability produces zero visible options here, by the SAME gate.

Net effect: the bot never activates Farrelite Priest's mana ability today
(a pre-existing gap this issue did not introduce), and Urza's tap-another-
artifact ability inherits the identical blind spot. `activateManaAbility`
(`convex/game.ts:13692`) is a fully correct, directly-callable mutation for
this shape — it's just never _reached_ by the bot's own move/valuation
machinery.

**Why it wasn't fixed here.** Closing it needs either (a) a NEW bot move
kind for "activate a standalone, non-tap mana ability" in
`enumerateAbilityMoves` (currently hard-scoped to `useStack: true`), wired
through to `applyMove`/valuation, or (b) generalizing `planManaPayment`'s
one-card-one-tap `PlanSource` model to a source that, when selected, taps a
DIFFERENT permanent than the one enumerated (Urza's shape specifically) —
either is a cross-cutting AI-subsystem change well beyond a single card's
scope, and risks destabilizing the auto-tap planner every spell cast already
depends on.

**Why it may not deserve its own issue yet.** Only two cards in the whole
catalogue have this ability shape (Farrelite Priest, Urza), and Farrelite
Priest has shipped with the same gap with no reported bot-strength complaint.
Worth a ticket once a THIRD card needing this shape lands, or once someone
audits the bot's mana-source coverage generally (`/bot-slice` territory) —
premature to open now on the strength of one card noticing it.
