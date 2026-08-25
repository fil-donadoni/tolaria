# Loyalty is priced as a RATIO of the planeswalker's own worth, with a derived ceiling, and a variable `-X` cost never clamps

## Status

accepted

## Context

Issue #2491 opened two bot-side gaps on the same mechanic, both of which had to
close together (`.claude/rules/gre-development.md`: a mechanic ships WHOLE).

**Enumeration.** `enumerateAbilityMoves` skipped, unconditionally, every
activated ability carrying a signed `cost.loyalty`. Measured against the live
catalogue: 13 planeswalkers, 37 loyalty abilities, zero reachable by the bot.
Closing that is a rules-plumbing change, not a design decision — the CR 606
gates already existed once, on the mutation path, and the fix was to move them
into pure engine code (`convex/gre/loyalty.ts`) so the enumerator, the search's
cost payer and the mutation's throwing wrapper all read one authority. No ADR
is needed for that half.

**Evaluation** is the half that needed a decision. A planeswalker scored as a
generic non-creature permanent: the flat board-presence bonus (`W_PERMANENT`)
plus its latent `cardValue`. Loyalty counters carried **no weight at all**. So
once the moves existed, the leaf evaluation could not tell a `+1` from a `-3`:
spending six counters on an ultimate cost the bot nothing unless the walker
landed exactly on 0 and the CR 704.5i state-based action swept it, and banking
a counter gained nothing beyond the ability's own effect. Two candidates that
score identically inside `OUTCOME_EPS` are separated by rollout noise — the
shipped shape of the Damnation-on-an-empty-board and Wild-Growth-for-the-
opponent failures.

Three candidate models were on the table:

1. **Additive** — a tuned constant per loyalty counter, added to the walker's
   term. Rejected: it invents a number nobody can derive, it shifts every
   existing eval baseline the moment it ships, and it prices a counter on
   Jace, the Mind Sculptor (12-loyalty ultimate) the same as one on Narset,
   Parter of Veils (a single `-2`).
2. **Per-ability lookahead** — value the walker at the best ability it can
   currently afford. Rejected: it duplicates what the search already does one
   ply deeper, and it makes the leaf non-monotone in loyalty (crossing an
   ability's threshold jumps the score).
3. **Ratio of the walker's own worth** — adopted below.

## Decision

A planeswalker's realized worth in the per-player evaluation terms builder is
its `cardValue` **scaled** by how much of its useful loyalty range it currently
holds:

```
ratio    = min(currentLoyalty, ceiling) / startingLoyalty
ceiling  = max(startingLoyalty, maxSpend) + 1
maxSpend = the largest magnitude among the walker's NEGATIVE loyalty costs
```

The flat board-presence bonus stays **unscaled** — it prices "a permanent is
here", equally true at 1 loyalty and at 6.

Four rules make this closed:

- **Nothing is invented.** Both inputs — the printed starting loyalty
  (CR 306.5b) and the abilities' signed costs (CR 606.4) — are already on the
  card definition. There is no tunable constant, so there is nothing to drift
  and nothing to re-tune per card.
- **No baseline shift.** `ceiling > startingLoyalty` always, so at starting
  loyalty the ratio is exactly `1` and every walker scores precisely what it
  scored before the term existed. Existing blade entries, eval tests and ladder
  baselines keep their numbers. This is asserted catalogue-wide, through the
  real evaluation reducer, against the same flat bonus an ordinary non-creature
  permanent receives.
- **The ceiling means "counters this card can still SPEND".** One past the
  biggest printed spend is the last counter that changes what the walker can do
  next turn — the buffer that eats a point of damage and still fires the
  ultimate. Beyond it the counters are dead weight and stop earning. The `+ 1`
  is also what guarantees no walker has a `+1` tick worth exactly zero: from any
  loyalty at or below the starting count, one more counter is still under the
  ceiling. Three shipped walkers whose biggest spend is smaller than their
  starting loyalty (Minsc & Boo, Narset, Teferi, Time Raveler) get their whole
  gradient from that buffer.
- **A variable (`-X`) loyalty cost never clamps.** CR 606.6 bounds X at the
  permanent's current loyalty, so such a walker can spend _every_ counter and
  none is ever dead weight — its ceiling is unbounded. `cost.loyalty` is typed
  as a plain `number` today, so no shipped card can express this; the rule is
  written now, and pinned by a constructed fixture, so the ~23 cards of that
  class land correctly when the type widens instead of re-opening the decision.

Death at 0 falls out arithmetically — ratio 0, then CR 704.5i removes the
permanent. No special case.

## Consequences

- A `-N` that lands the walker on exactly 0 stays legal (CR 606.6 forbids only
  going _below_) and is now correctly priced by the loss of the whole permanent.
- Attacking an opponent's planeswalker becomes correctly valued for free. The
  rollout horizon is the bot's next turn — past combat damage — so the leaf sees
  the removed counters as ordinary material, exactly as it sees lost life and
  dead creatures. (The PRE-resolution combat lookahead still values a
  walker-directed attack at zero; that is #2799, behind #2798, deliberately
  landed separately so a regression stays attributable.)
- The term is inert for the entire rest of the catalogue: the ratio is `1` for
  anything that is not a planeswalker with a printed starting loyalty,
  including a permanent that became a planeswalker through a layer-4 type
  addition and therefore has no denominator.
- The value is read from the definition **by id**, never off the fat
  `card.card` object, so the client-side Brain and the server compute the same
  leaf either side of `projectPublicState`.
- Because the model is monotone in loyalty and has no thresholds, it composes
  with the search rather than competing with it: the leaf says how much a
  counter is worth, and the search says which ability to spend it on.

## References

- Issue #2491 (both halves: enumeration and evaluation)
- CR 306.5b (starting loyalty), CR 606.2/606.3/606.4/606.6 (loyalty abilities),
  CR 704.5i (the zero-loyalty state-based action)
- ADR 0058 (the loyalty framework slice this completes for the bot)
- ADR 0018 (latent `cardValue`, the quantity being scaled)
- ADR 0070 (blade-entry discipline — the discriminating pair that pins this)
