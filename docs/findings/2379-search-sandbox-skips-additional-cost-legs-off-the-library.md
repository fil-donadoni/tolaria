---
title: The search sandbox charges no additional-cost leg for a spell cast off the top of the library
discoveredBy: 2379
status: draft
confidence: high
---

**What is wrong.**

`applyAdditionalCostLegForSearch` (`convex/gre/applyMove.ts:206`) resolves the
cast card out of `player.hand` only. A spell cast from the top of the library —
the permission Bolas's Citadel grants (#2398) — is not in hand, so the helper
returns early and the announced leg is never charged inside the search tree.

The two legs of a `oneOf` additional cost therefore become indistinguishable
again to the Bot, which is precisely the mis-pick #2379 exists to prevent,
confined to the Citadel ∩ `oneOf` intersection.

**Evidence.**

Probed on the merged tree: Bitter Triumph on top of the library under a
Bolas's Citadel enumerates **both** legs (`convex/gre/moves.ts:1942-1959` calls
the same `enumerateCastMoves`, and `payableAdditionalCostLegs` reads
`def.additionalCosts`, which is zone-agnostic), and `applyMoveForSearch` then
moves life 20 → 18 — the Citadel mana-value life only. The 3-life leg is free.

The hand-only lookup is not accidental: the leg payment must run **before**
`removeFromZone`, and moving it after reds
`convex/gre/__tests__/additionalCostLegs.bot.test.ts` ("the GREEDY sandbox
CHARGES the leg it announced") for exactly that reason. Widening the lookup is
therefore a real behaviour change, not a one-line fix.

The server commit path is unaffected — `announceCast` charges correctly at both
sites — so nothing freezes and no illegal state is reachable. This is a search
valuation gap only.

**Why it may not deserve its own issue.**

The intersection did not exist until #2398 and #2379 landed in the same batch,
and today exactly one card sits on each side of it. If the `oneOf` shape stays
rare, this is a line on #1525 rather than a ticket. It becomes worth one the
moment a second `oneOf` card ships, since the cost of the gap is a silently
worse Bot line rather than a visible failure.

This is distinct from `2398-library-top-cast-misses-hand-only-cost-hints.md`,
which is about client projection hints; this one is the search sandbox.
