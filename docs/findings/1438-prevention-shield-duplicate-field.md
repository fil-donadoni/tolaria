---
title: preventionEffects and playerDamagePrevention are the same CR 615 shield in two parallel GameState fields
discoveredBy: 1438
status: draft
confidence: medium
---

**What is wrong.** Two `GameState` fields store the same semantics with two
types, two ctx primitives and two consumer families. A "prevent the next damage
from one source to one player" shield is expressible in both, so which one a
card uses is historical accident rather than meaning — and any code that reads
one and not the other silently misses half the shields.

**Evidence.**

- `preventionEffects?: PreventionEffect[]` — `convex/gre/state.ts:4753`, type at
  `:2009` (`{ sourceInstanceId, playerId, duration }`), written by
  `SpellContext.preventNextDamageFromSource` (`convex/cards/types.ts:4860`,
  impl `convex/gre/state.ts:15574`). Consumers: the Circle of Protection
  mechanism — `convex/cards/sets/ice/colorless.ts:1290`,
  `convex/cards/sets/ice/white.ts:1725`, shared template
  `convex/cards/abilities/index.ts:543`.
- `playerDamagePrevention?: PlayerDamagePreventionShield[]` —
  `convex/gre/state.ts:4762`, type at `:2048`, written by
  `SpellContext.addPlayerDamagePreventionShield`
  (`convex/cards/types.ts:4898`, impl `convex/gre/state.ts:15694`). Consumers:
  Dark Sphere and Scarecrow — `convex/cards/sets/drk/colorless.ts:127-160`,
  `:349-380`.

`PreventionEffect` is exactly
`addPlayerDamagePreventionShield(playerId, { sourceInstanceId }, "all", duration, 1)`.
The narrower field predates the general one: the DRK batch note
(`convex/cards/sets/drk/colorless.ts:16-18`) records the general shield arriving
as one of "four small, orthogonal engine primitives … added for this batch",
with no pass to fold the older field into it.

**Why it may not deserve its own issue.** Nothing is observably broken today —
both fields are read at the CR 615 consumption site, so no shield is dropped at
HEAD. The cost is latent: a future reader of prevention state (a Bot valuation
term, a projection, a new replacement-ordering pass under #2054/#3350) has two
places to look and will plausibly find one. If that is judged acceptable, this
is a line on the CR 616.1 replacement/prevention work rather than a ticket; if
it is not, the fold is mechanical — migrate the three Circle-of-Protection call
sites onto `addPlayerDamagePreventionShield` and delete `PreventionEffect`.

**Provenance.** Noticed during the `/audit-tracker` pass on #1438
(audited at `ae09e3266`, 2026-09-12) while re-deriving whether the six
prevention/redirection primitives the tracker listed as "missing Ops" were
genuinely missing. They are not — all six ship — but the audit was not asked to
touch the duplication it walked into.
