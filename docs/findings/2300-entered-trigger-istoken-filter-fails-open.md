---
title: enteredTrigger's filter.isToken fails OPEN — a nontoken-only ETB trigger would match a token
discoveredBy: 2300
status: draft
confidence: medium
---

**What is wrong.** `enteredTrigger`'s `matches` builds the `MatchablePermanent`
it filters on **purely from the event payload**, and never populates `isToken`.
`matchesPermanentFilter` treats an absent `isToken` as `false`. So a card
written as `enteredTrigger({ filter: { isToken: false } })` — "whenever a
**nontoken** creature you control enters" — would happily fire on a token.

This fails in the dangerous direction only for `isToken: false`.
`isToken: true` fails closed (safe), as do `subtypes` / `staticAbilities` /
`colors`, which the factory hardcodes empty or omits.

**Evidence.**

- `convex/cards/abilities/triggers/enteredTrigger.ts:141-147` — the subject is
  `{ id, types, subtypes: [], staticAbilities: [], controllerId }`. No
  `isToken`, no `power`/`toughness`, no `colors`.
- `convex/cards/filters.ts:378-381` —
  `const cardIsToken = card.isToken === true; if (filter.isToken !== cardIsToken) return false;`
  With the field absent, `cardIsToken` is `false`, so `filter.isToken: false`
  passes for a token.
- **Zero shipped consumers today.** A sweep of all 133 `enteredTrigger()` +
  5 `landfallTrigger()` call sites under `convex/cards/sets/**` found no
  `filter.isToken` at any of them. The only `isToken: false` uses in the
  catalogue are on `copySourceFilter` / `targetRequirement` / `sacrificeFilter`
  (`convex/cards/sets/drk/blue.ts:869,882`), which are different filter sites
  with correctly-populated subjects.

**Why this matters now.** Before issue #2300 the trap was _unreachable_: token
entry emitted no `PERMANENT_ENTERED` at all, so no ETB filter ever saw a token
and `isToken: false` was vacuously correct. #2300 makes tokens flow through
every one of these predicates for the first time, so the next card that writes
"whenever a nontoken creature enters" will silently be wrong.

The four cards that DO need characteristics the payload lacks all work around it
today by reading the live instance off `state` in a `condition` closure
(`inv/red.ts:503`, `inv/green.ts:367`, `fem/green.ts:638`, `fem/black.ts:780`)
— which is exactly the workaround a future author would have to rediscover.

**Why it may not deserve its own issue.** No shipped card is wrong, so this is a
latent trap rather than a defect, and the issue that surfaced it explicitly put
"adding new fields to the entry event payload" out of scope. Two cheap fixes
exist and neither needs a payload change:

1. populate `isToken` on the subject from the live battlefield instance the
   factory can already reach via its `state` parameter; or
2. make the factory reject a `filter` naming a field it cannot populate, so the
   failure is loud at authoring time instead of silent at runtime.

If it isn't ticketed, it belongs as a line on whichever tracker owns
filter-fail-open hygiene rather than as a standalone ticket.
