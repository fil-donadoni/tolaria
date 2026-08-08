---
title: Sacrifice-cost mana abilities behave differently depending on which tap path activates them
discoveredBy: 2363
status: draft
confidence: medium
---

**What is wrong.** There are two entry points that activate a `useStack: false`
mana ability — `tapUntap` (the player taps a source at priority) and
`tapSourceIntoPayment` (the source is tapped mid-payment by the auto-tap solver
or the payment picker). They do not agree on what a **sacrifice-cost** mana
ability does, and the divergence is invisible from either one alone.

Two concrete cases, both found while writing the #2363 behaviour tests:

- **`sacrificeFilter` is never enforced or paid.** Orcish Lumberjack
  (`convex/cards/sets/ice/red.ts`) is `{T}, Sacrifice a Forest: Add {R}{R}{R}`
  — the ability declares `sacrificeFilter: { subtypes: "Forest" }`. Tapping it
  through `tapSourceIntoPayment` succeeds and adds the mana **with zero Forests
  on the battlefield**, and does not remove a Forest when one is present. The
  cost is decorative on this path.
- **A delayed trigger is armed on one path only.** Barbed Sextant
  (`convex/cards/sets/ice/colorless.ts`) arms a next-upkeep draw when tapped.
  `tapUntap` arms it; `tapSourceIntoPayment` skips arming it when
  `cost.sacrifice === true`, behind an `if (!isSacrifice)` guard. So the same
  card yields a different game state depending on whether the player tapped it
  before or during payment.

**Evidence.** Both confirmed empirically against HEAD while writing
`convex/cards/sets/ice/__tests__/red.test.ts` and
`convex/cards/sets/ice/__tests__/colorless.test.ts`; the tests were
deliberately scoped to the `manaChoices` index → mana-pool mapping so they do
not encode either behaviour as correct. The producer set is small and
enumerable: grep `cost.*sacrifice` over `activatedAbilities` with
`useStack: false`.

**Why it may not deserve its own issue.** Sacrifice-cost mana sources are rare
in the current catalogue and the auto-tap solver already prefers
non-destructive options (the mana sweep documents this as a deliberate skip),
so the divergent path may be nearly unreachable in real play. The
counter-argument: "nearly unreachable" is exactly the shape that ships a silent
free-mana bug the day a deck runs a sac-land, and the fix is one shared
cost-payment helper rather than two.
