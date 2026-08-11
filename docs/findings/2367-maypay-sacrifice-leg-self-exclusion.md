---
title: Two resolve() cards are blocked on a self-exclusion gap that PermanentFilter.excludeSource now closes
discoveredBy: 2367
status: draft
confidence: medium
---

**What is wrong.** Two cards carry a recorded "NOT DSL-migratable" justification
whose stated blocker is exactly the gap issue #2367 just closed — "a creature
OTHER THAN this one" in a `mayPay` sacrifice-leg filter. The justification is now
stale, so both read as permanently protocol-like when they are one field away
from being ordinary DSL cards.

**Evidence.**

- `convex/cards/sets/ice/black.ts:2163-2176` (Minion of Leshrac) — the comment
  says the `mayPay` Op's cost union already supports a sacrifice leg and
  `if !$paid` already covers the declined branch; "what remains unexpressible is
  'a creature OTHER THAN this one'… `EffectCardFilter`/the JSON-pure Effect
  Script has no way to inject the SOURCE's own (runtime, per-instance) id into
  that filter". `PermanentFilter.excludeSource` (`convex/cards/filters.ts:117`,
  shipped in #2367) is precisely that injection-free form, and a `mayPay`
  permanent leg's `filter` IS a `PermanentFilter`
  (`MayPayCost.permanent.filter`).
- The same comment names `Lord of the Pit` (`convex/cards/sets/lea/black.ts`) as
  carrying the identical gap.
- `convex/cards/sets/drk/red.ts:758-761` (Orc General, touched by this PR) has a
  second, different stale justification — "the forEach permanents filter can't
  express 'other' (no exclude-source)". It can: the `forEach` permanents
  selector has had its own `excludeSource` since `convex/cards/types.ts:9894`,
  lowered by `convex/gre/effects/interpreter.ts:5004`.

**What would need doing.** Not just a text swap: the `mayPay` sacrifice-leg
readers (`mayPaySacrificeCount` / `mayPaySacrificePower`,
`src/lib/card-utils.ts`, and their server twins) do NOT currently thread
`ctx.selfInstanceId`, so an `excludeSource` filter there fails CLOSED today — the
Pay button would be permanently disabled rather than wrongly enabled. That is the
safe direction by design, but it means the migration is "thread the id at the
mayPay readers, then migrate the three cards", not a one-line edit.

**Why it may not deserve its own issue.** This is migration work
(`resolve()`→`effects[]`, PRD #795 / the migration lane), and each of the three
cards is already enumerated there — so it is plausibly three lines on the
migration tracker rather than a ticket. It is worth recording because the
BLOCKER text on all three cards now actively misinforms the next migrator: a
reader who trusts the comment will skip the card without re-checking, which is
how a stale justification outlives the gap it describes.
