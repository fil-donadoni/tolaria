---
title: A token's synthesized mana cost gives it a nonzero mana value (CR 111.4 says 0)
discoveredBy: 2300
status: draft
confidence: medium
---

**What is wrong.** `createTokenPermanents` encodes a token's COLORS as a
synthetic mana cost — one pip per colour — and registers that on the token's
synthesized `CardDefinition`. That is how token colours work (and it is
correct for colour: `getEffectiveColors` reads the cost). But mana value is
derived from the same field, so a blue Thopter token reads **mana value 1**, and
a two-colour token reads **2**, where CR 111.4 says a token has no mana cost and
therefore mana value **0**.

**Evidence.**

- `convex/gre/state.ts:16059-16062` — `for (const c of spec.colors ?? []) manaCost[c] = (manaCost[c] ?? 0) + 1;`
  then registered at `:16075` as the token definition's `manaCost`.
- `convex/gre/constants.ts:183-189` — `manaValue()` sums `W/U/B/R/G/C/X/generic`,
  so those colour pips count.
- `convex/cards/effectiveColors.ts:54-58` — the colour read that legitimately
  depends on this encoding, which is why the encoding cannot simply be deleted.

**Why this matters now.** Pre-existing, but issue #2300 widens its reach: tokens
now flow through every `PERMANENT_ENTERED` consumer, so an ETB trigger filtering
on `manaValueAtMost` / `manaValueEquals` (both shipped filter fields —
`convex/cards/sets/mbs/green.ts:41`, `convex/cards/sets/inv/blue.ts:971`) will
now see tokens and score them wrong. No shipped ETB trigger uses a mana-value
filter today, so nothing is currently miscounted through this path.

**Why it may not deserve its own issue.** Nothing observable is broken yet, and
the fix is not a one-liner: colour and mana value share one field today, so
separating them means either a real `colors` field on the token definition (and
migrating `getEffectiveColors` to prefer it) or a `isToken → manaValue 0`
special case in `manaValue()`, which is the kind of type-aware branch that
module deliberately avoids. It may be better folded into whatever work next
touches token characteristics than ticketed on its own.
