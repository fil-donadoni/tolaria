---
title: matchesPermanentFilter (client choice-picker) hand-duplicates excludeSupertypes and misses the granted/removed-supertype overlay
discoveredBy: 1735
status: draft
confidence: medium
---

**What is wrong.** The client-side "may-pay" / choice-picker predicate
`matchesPermanentFilter` (`src/lib/card-utils.ts`) implements its
`excludeSupertypes` clause by reading the PRINTED definition directly:

```ts
const cardSupertypes: string[] =
    tryGetDefinition(card.card.id)?.supertypes ?? [];
if (excluded.some((s) => cardSupertypes.includes(s))) return false;
```

The shared, registry-backed authority for "live" supertype status is
`hasSupertypeLive` (`convex/cards/snowReads.ts:32-54`, via `snowReads.ts`'s
`printedSupertypes` → `supertypesForCardId`): printed supertypes overlaid by
any `grantedSupertypes` / `removedSupertypes` mutation on the instance
(Melting, Arcum's Weathervane-style indefinite `setSupertype` effects). The
server's own `supertypeFilter` / `excludeSupertypes` target-filter dimension
(`convex/gre/targetFilters.ts`, per issue #1735's census) already routes
through this authority. `matchesPermanentFilter` does not — it reads only the
printed list, so a permanent whose Legendary-ness was GRANTED or REMOVED by a
static/indefinite effect since it entered evaluates differently in this
picker than everywhere else in the codebase that decides the same question.

This is a **second, independent** divergence from the one issue #1735 fixes
(the face-down `card.card.id` restore feeding id-derived filters). It happens
to read the same field this issue touched (`card.card.id`) but the bug shape
is different: it is not about WHICH id is honest, it is about which
COMPUTATION the client runs once it has an honest id — a hand-rolled
supertype lookup instead of the shared `hasSupertypeLive` predicate.

**Evidence.** `src/lib/card-utils.ts:857-863` (line numbers as of this PR;
`matchesPermanentFilter` starts at line 817):

```ts
if (filter.excludeSupertypes !== undefined) {
    const excluded = Array.isArray(filter.excludeSupertypes)
        ? filter.excludeSupertypes
        : [filter.excludeSupertypes];
    const cardSupertypes: string[] =
        tryGetDefinition(card.card.id)?.supertypes ?? [];
    if (excluded.some((s) => cardSupertypes.includes(s))) return false;
}
```

Contrast with `convex/cards/snowReads.ts:29-54` (`printedSupertypes` +
`hasSupertypeLive`), which folds in `grantedSupertypes` / `removedSupertypes`
before answering the same question, and is what the server-side
`supertypeFilter` target-filter registry entry actually calls.

**Why it may not deserve its own issue.** `matchesPermanentFilter` backs the
client's may-pay / activation-cost permanent picker (sacrifice/exile-cost
filters, CR 602.1), not the target-selection ring `matchesPermanentTargetFilters`
already fixed for this dimension in PR #1732 / issue #1697. I did not find a
shipped card whose cost filter combines `excludeSupertypes` with a
supertype-granting/removing effect (Melting, Arcum's Weathervane) actually in
play at cost-payment time, so the divergence may be latent rather than
reachable today — the same "is it defensible without the card that surfaces
it" bar the project applies to new issues. Worth a grep sweep across
`convex/cards/sets/**` for cost filters combining `excludeSupertypes` with a
supertype-mutating effect before ticketing; if none exist, this is a line item
on a general "client picker predicates should call the shared registry
helpers" cleanup rather than its own issue.
