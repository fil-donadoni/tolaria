# The Bot's hand-written code against the catalogue, and the Verdicts nobody promoted

> **Measured at** `bd6701484` (2026-11-26), on the base branch. The Verdict
> Store rows were read from the bucket the same day. Every number below is as
> of that commit and that day. Taken during the owner's grill that produced
> [ADR 0186](../adr/0186-the-evaluation-grows-a-generated-vector-fitted-behind-measured-gates.md).

**Question.** Two claims were on the table in the grill. The first: the play
Bot's code grows per mechanic, so it grows much more slowly than the
catalogue. The second: the Verdicts given in production since October are
reaching the Weight Fit. Both were checked.

**Verdict up front.**

1. **The first claim is false.** Since 2026-08-01 the card index grew 5.6
   times and the Bot's reading, evaluation and search code grew about 4 times
   in lines and 7 times in modules. The Effect Script vocabulary grew 1.7
   times in the same period, so the Bot's code follows the cards, not the Ops.
2. **The second claim is false too, and nothing is broken.** The Verdict Store
   holds 184 Verdicts; the Verdict Lock names 101 and has not moved since
   2026-10-03. 74 promotable Verdicts wait outside it, because
   `bun run verdicts:promote` is run by hand and nobody ran it.

## 1. Code against catalogue

Lines of three files and counts of two registries, read with `git show` at
the last base commit before each date.

| Date       | Commit      | Card index rows | Op rows | `ai/opValuers.ts` | `evaluate.ts` | `search.ts` | Modules in `gre/ai/` |
| ---------- | ----------- | --------------- | ------- | ----------------- | ------------- | ----------- | -------------------- |
| 2026-08-01 | `de5e89118` | 1,950           | 80      | 1,236             | 950           | 2,318       | 13                   |
| 2026-09-15 | `7ef6e8888` | 4,483           | 101     | 2,606             | 2,117         | 5,484       | 27                   |
| 2026-11-01 | `70cd34688` | 8,918           | 124     | 4,267             | 3,120         | 7,124       | 71                   |
| 2026-11-26 | `bd6701484` | 10,999          | 139     | 4,697             | 3,762         | 9,394       | 93                   |

"Card index rows" is the length of `data/card-index.json`. "Op rows" counts
the `op:` rows of `convex/cards/mechanicsRegistry.ts`. "Modules" counts the
`.ts` files directly under `convex/gre/ai/`, tests, `blade/` and `verdicts/`
excluded.

The three files together went from 4,504 lines to 17,853: 13,349 lines for
9,049 cards, about 1,475 lines per 1,000 cards.

What the table does not separate: part of that growth is work on the search's
quality that no card asked for (priors, tree reuse, the rollout policy). The
share is not measured here, so the ratio is an upper bound on what the cards
cost.

## 2. What is left to compile

Read from `data/oracle-compiled.json` at the same commit (corpus of
2026-11-22, 35,420 cards).

| State        | Cards  |
| ------------ | ------ |
| `ready`      | 9,646  |
| `unparsed`   | 25,688 |
| `quarantine` | 86     |

The file lists 28,699 Oracle fragments the grammar does not read. 27,145 of
them (95%) block exactly one card; 1,291 block two to four, 239 block five to
nineteen, 24 block twenty or more. 20,269 of the unparsed cards are blocked
only by fragments that appear on no other card.

A fragment is a line of text, not a mechanic. One Grammar Rule often clears
many fragments that differ by a number or a subtype, so "95% unique" is an
upper bound on the share of single-card mechanics. It does say the remaining
block is a long tail.

## 3. The Verdict Store against the Verdict Lock

`gcloud storage ls -l` on the store's `verdicts/` prefix, and
`bun run verdicts:validate` (read-only).

| Month the Verdict was stored | Verdicts | Outside the lock |
| ---------------------------- | -------- | ---------------- |
| 2026-09                      | 104      | 3                |
| 2026-10                      | 31       | 31               |
| 2026-11                      | 49       | 49               |
| Total                        | 184      | 83               |

`verdicts:validate` reads 175 of the 184 as promotable. The lock names 101, so
74 promotable Verdicts are outside it. The other nine:

- eight are `invalid`: three do not rebuild because the token name
  `Food (C ability)` is unknown to the token catalogue, four name a candidate
  the rebuilt position no longer enumerates (three "cast Deathrite Shaman",
  one "activate Strip Mine → Plains"), and one declares a resolution
  checkpoint that does not re-suspend on a Pending Choice;
- one is a Conditional Verdict with no right-hand half (the Discriminant is
  Serra's Sanctum added).

None is contested, unattested or rejected.

The last commit that moved `data/verdicts.lock.json` is `c43c4b5a3c`
(2026-10-03). No workflow, cron or health step runs a Promotion; the guide
says to run it by hand.

## What was not measured

- How much of § 1's growth is card-driven. It needs a per-commit attribution
  nobody has done.
- How many of the 74 waiting Verdicts the current Evaluation already orders
  correctly. ADR 0186 keeps them out of the fit on purpose, so they are the
  first thing the held-out reading will say.
