---
title: Two repo-wide classes of resolvable-but-wrong CR citations — 701.9a for discard choice/randomness, 606.5 for loyalty cost and the below-zero rule
discoveredBy: 2360
status: draft
confidence: high
---

**What is wrong.** Two conventions have propagated across the repo in which the
cited rule id RESOLVES but says something other than what the comment claims.
`bun run cr:lint` cannot see either: its first scan only asks whether an id
exists, and its keyword-title scan (`scripts/cr-keyword-citations.ts`) keys on
the SECTION title — both classes cite the right section and the wrong subrule, so
the title matches and the line passes. PR #2566 corrected only the five sites it
introduced, deliberately leaving the pre-existing convention for its own change.

**Class A — `CR 701.9a` used for who-chooses and for random discard.** Printed:

- `701.9a` — "To discard a card, move it from its owner's hand to that player's
  graveyard." (the ZONE MOVE, nothing else)
- `701.9b` — "By default, effects that cause a player to discard a card allow the
  affected player to choose which card to discard. Some effects, however, require
  a random discard or allow another player to choose which card is discarded."

Every citation asserting either "the discarding player chooses" or "discards at
random" therefore wants **701.9b**. 25 `.ts` sites carry `701.9a` today and the
large majority make one of those two claims. Representatives:
`convex/gre/effects/interpreter.ts:1907` ("random discard: `count` cards chosen
AT RANDOM"), `convex/cards/types.ts:3289` and `:12985` (both the `discardAtRandom`
Op docs), `convex/gre/effects/__tests__/interpreter.test.ts:23516` (the Op's
describe), `convex/cards/sets/p02/black.ts:10` ("the discarding player also
chooses which card"), `convex/cards/sets/mh2/black.ts:18`,
`convex/cards/sets/pls/black.ts:177`, `convex/cards/sets/fem/__tests__/black.test.ts:436`.

**Class B — `CR 606.5` used for two different wrong things.** Printed:

- `606.4` — "The cost to activate a loyalty ability of a permanent is to put on
  or remove from that permanent a certain number of loyalty counters, as shown by
  the loyalty symbol in the ability's cost."
- `606.5` — "If the total cost to activate a loyalty ability contains multiple
  costs to add or remove loyalty counters, those costs are combined into a single
  cost…" (cost COMBINING — the Carth the Lion case, which this engine does not
  ship)
- `606.6` — "A loyalty ability with a negative loyalty cost, taking into account
  any additional costs, can't be activated unless the permanent has at least that
  many loyalty counters on it."

So `606.5` is wrong in both directions it is used:

- **B1, wants 606.4** — "`+N` adds N counters / `-N` removes N counters", and the
  cost-payment sites. ~9 sites: `convex/cards/sets/wwk/blue.ts:48,87,97`,
  `convex/cards/sets/war/multicolor.ts:77,94`, `convex/cards/sets/war/blue.ts:54`,
  `convex/cards/sets/isd/black.ts:73,94`,
  `convex/cards/sets/ori/__tests__/blue.test.ts:231`. The payment-path comments
  (`convex/game.ts:5677,6292,13543`,
  `convex/gre/__tests__/loyalty.test.ts:151`) describe paying that same cost and
  belong with them.
- **B2, wants 606.6** — "a `-N` cost may not take loyalty below 0". This is the
  load-bearing one: it is the rule the activation gate actually implements, and
  it is miscited in the engine, the client, the ADR and the domain doc.
  `convex/game.ts:5646,5667`, `convex/gre/sba.ts:408`,
  `convex/gre/applyMove.ts:226`, `convex/cards/types.ts:956`,
  `src/lib/card-utils.ts:2040`,
  `convex/gre/__tests__/loyalty.test.ts:9,174,212`,
  `convex/cards/sets/mh3/__tests__/blue.test.ts:317`,
  `docs/adr/0058-loyalty-abilities-as-signed-cost-member.md:50`, `CONTEXT.md:116`.
  26 `.ts`/`.md` sites carry `606.5` in total across B1 and B2.

**Evidence.** All six rule texts above were printed with `bun run cr <id>` against
the vendored document, not recalled. `bun run cr 606` shows the whole section in
one pass and makes the 606.4 / 606.5 / 606.6 split immediate.

**Why it may not deserve its own issue.** It is a comment-only sweep with zero
behaviour change, which makes it cheap but also makes it collide with every open
branch touching those files — a rebase tax paid by whichever PRs are in flight.
It may be better folded into the next pass that already touches the loyalty
framework (B2's sites cluster tightly around the activation gate) than run as a
standalone repo-wide edit. It is also worth deciding first whether `cr:lint` can
be strengthened to catch the class rather than only this instance of it: the
keyword-title scan already proves the SECTION is right, and a subrule-level check
would need the comment's claim matched against the subrule TEXT — plausible for a
small vocabulary of recurring claims ("at random", "chooses which", "below 0"),
not in general. Fixing the sites without fixing the scanner means the convention
regrows.
