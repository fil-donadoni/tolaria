# The Ceiling gate: the two reference Lines under a forced guide (issue #10861, ADR 0186)

> **Measured at** `0f3f4f8dd` (2026-11-27), branch `feat/issue-10861` on the
> base tip `f72a867e7`, on the hosted `blade-census.yml` matrix: 15 arms, all
> dispatched at 03:08 UTC on that one sha. The root-rule readings of § 3 and
> the two diagnostic arms of § 4 ran locally on the Huawei runner at
> `f6fc598d1`, which differs from `0f3f4f8dd` only in a doc comment, and at
> `11bf86f2c`, which only adds the `mechanism` field to the Line row. Slice of
> PRD issue #10849. Re-run before quoting a number.

**Question.** The third gate of PRD issue #10849 asks one thing before any
guide is trained: if the guide were perfect, would the search find the Line at
the budgets real games reach? The instrument is the forced-guide variant of
PR #10926 (issue #10860). Along a bound Line it gives the Line's move the whole
prior at every Bot decision, in the tree and in the rollouts, and changes
nothing else. The root pick stays the search's own.

**Pass rule, registered in issue #10861 before measuring:** under the forced
guide, at the Chromium field budget, the Bot plays the first move of each
reference Line on a majority of seeds and carries the Amulet Line to its end.

**Verdict up front: FAIL.** At the Chromium budget (387) the forced guide plays
Amulet's first move on 3 of 3 seeds, Tron's on 0 of 3, and carries Amulet to
its end on 0 of 3. The forced guide changes no outcome at 160, 387 or 400.
At 94 it recovers Amulet's first decision. Neither stop is a guide failure:

1. **Amulet stops at decision 3 because of a root rule, not the search.** The
   search's own argmax casts Summoner's Pact on every seed, arm and budget
   from 94 up. The Pact has more visits and a higher mean reward than `pass`
   (forced guide, 400: 216 visits at 0.6104 against 184 at 0.6052). The
   `last-window-deferral` root rule then swaps the pick to `pass`, because the
   Pact is an instant and the gain is within `OUTCOME_EPS`. The rule's premise
   (acting now and at the opponent's end step reach the same board) is false
   here: the Pact's payoff is a sorcery-speed Primeval Titan this turn.
2. **Tron stops at decision 1 on the Evaluation of the intermediate position.**
   The search rates activating Expedition Map below `pass` on every seed, arm
   and budget, by 0.007 to 0.013 of mean reward. The forced guide gives the
   Map more visits (183 → 205 at 400) and leaves its value where it was
   (0.5266 → 0.5267). The payoff, Tron assembled and seven mana, comes after
   every rollout ends.

A trained guide alone would fix neither. The first needs the rule's premise
check (`waitsUnchanged`) to see a payoff the wait forfeits. The second needs an
Evaluation that reads a position one tutor away from its payoff, the Deck
Needs family of the generated vector (issue #10856).

## 1. The arms

`bun run blade:census --tier stretch --match '^line: (Amulet|Tron)'`, which
selects the four reference Lines of `convex/gre/ai/blade/lines.ts` (issue
#10859): the Amulet Titan Line, its one-mana-short pair, the Tron Line and its
Stone Rain sibling. Each has three seeds (`0xb1ade`, 1, 2). The census runs a
Line forward at one seed through the live Brain path (`runBladeLine`), and its
row records each decision's root candidates.

Budgets: each Line's declared 400, and the field budgets of the latest field
reading (`field-reading-after-engine-changes.md`, 2026-11-21): Chromium 387,
desktop WebKit 160, Gecko 94. Arms: base, `forced-guide` and
`forced-guide-no-probes`.

| arm                      | declared (400) | 387         | 160         | 94          |
| ------------------------ | -------------- | ----------- | ----------- | ----------- |
| base                     | 45932393663    | 45932396373 | 45932399237 | 45932402269 |
| `forced-guide`           | 45932405552    | 45932408113 | 45932410822 | 45932413532 |
| `forced-guide-no-probes` | 45932416517    | 45932419128 | 45932421834 | 45932424431 |

Every slice succeeded. The merge jobs queued behind the `must` arms' slices,
so the 16 slice artifacts of each arm were downloaded and merged locally with
`bun run blade:census --merge`, the same command the merge job runs.

## 2. Per Line and per budget

Each cell gives the share of seeds that play the Line's first move, then the
share that reach its end, as `first / end`.

| Line                   | arm                      | 400       | 387       | 160       | 94        |
| ---------------------- | ------------------------ | --------- | --------- | --------- | --------- |
| Amulet Titan           | base                     | 3/3 · 0/3 | 3/3 · 0/3 | 3/3 · 0/3 | 0/3 · 0/3 |
|                        | `forced-guide`           | 3/3 · 0/3 | 3/3 · 0/3 | 3/3 · 0/3 | 3/3 · 0/3 |
|                        | `forced-guide-no-probes` | 3/3 · 0/3 | 3/3 · 0/3 | 3/3 · 0/3 | 3/3 · 0/3 |
| Amulet, one mana short | all three arms           | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 |
| Tron                   | all three arms           | 0/3 · 0/3 | 0/3 · 0/3 | 0/3 · 0/3 | 0/3 · 0/3 |
| Tron, Stone Rain       | all three arms           | 0/3 · 0/3 | 0/3 · 0/3 | 0/3 · 0/3 | 0/3 · 0/3 |

Where each seed stops: Amulet at decision 3 (casting Summoner's Pact) on every
red seed, except base at 94, which stops at decision 1. Both Tron Lines stop
at decision 1 (activating Expedition Map) on every seed. The one-mana-short
pair is a one-decision Line whose move is `pass`, so it is green everywhere,
and § 3 shows why that is not yet evidence.

## 3. Each failure, by cause

The numbers are the root candidates of the failing decision as the row
records them: visits, then mean reward from the Bot's side. The forced-guide
arm at 400 is quoted, seed `0xb1ade`. The other seeds are within 0.002 of mean
reward, and the other budgets show the same order.

### Amulet decision 3 — a root rule overrides the search

| arm                      | budget | Summoner's Pact | `pass`       | rule                   |
| ------------------------ | ------ | --------------- | ------------ | ---------------------- |
| base                     | 400    | 214 · 0.6091    | 186 · 0.6050 | `last-window-deferral` |
| `forced-guide`           | 400    | 216 · 0.6104    | 184 · 0.6052 | `last-window-deferral` |
| `forced-guide-no-probes` | 400    | 217 · 0.6103    | 183 · 0.6032 | `last-window-deferral` |
| `forced-guide`           | 94     | 50 · 0.6083     | 44 · 0.6045  | (hosted row, no rule)  |

The rule column comes from a local run of the same three arms at 400 on all
three seeds. The hosted rows were written before the Line row carried the
`mechanism` field. Iterations run are about 285 of 400 because the decision
continues the tree kept from decision 2 (`iterationsKept`).

The search found the Line: it gives the Pact the most visits and the higher
mean reward, under the forced guide and without it. The pick is swapped
afterwards by `last-window-deferral` (`selectRootMove`, issue #4757). An
instant cast before the opponent's end step waits for it unless it beats
`pass` by more than `OUTCOME_EPS`, and 0.005 does not. The rule's
identical-vector premise does not hold: Summoner's Pact cast at the end step
puts Primeval Titan in hand when it can no longer be cast, and the Pact's
upkeep trigger then comes due on the turn the Titan would be cast. The same
rule makes the one-mana-short pair green: § 4 shows it red with the rule off.

None of the issue's three causes applies. The horizon, the rollout and the
Evaluation all favour the Line's move here. A trained guide would change the
prior, and the prior is already forced to 1.

### Amulet decision 1 at 94, base arm only — the prior at a small budget

`pass` gets 50 visits at 0.5576 and transmuting Tolaria West gets 44 at
0.5575. The two values are equal to four digits, so the tiebreak follows the
visits. Both forced arms play the transmute at 94. This is the only failure
the forced guide removes, and it is the guide's cause by construction.

### Tron decision 1 — the Evaluation of the intermediate position

| arm                      | budget | Expedition Map | `pass`       |
| ------------------------ | ------ | -------------- | ------------ |
| base                     | 400    | 183 · 0.5266   | 217 · 0.5349 |
| `forced-guide`           | 400    | 205 · 0.5267   | 195 · 0.5352 |
| `forced-guide-no-probes` | 400    | 205 · 0.5255   | 195 · 0.5340 |
| base                     | 94     | 43 · 0.5313    | 51 · 0.5391  |
| `forced-guide`           | 94     | 50 · 0.5314    | 44 · 0.5381  |

The Stone Rain sibling has the same first decision and the same numbers. The
local reading at 387 under `forced-guide` names the search's own argmax
(`material-tiebreak`) on all three seeds, so no root rule is involved.

**The value of the intermediate position did not move.** The forced guide moves
22 visits onto the Map at 400 and 7 at 94. The Map's mean reward stays at
0.5266–0.5267 at 400 and at 0.5313–0.5314 at 94, and stays below `pass` by
0.0085 at 400. Forcing the rollouts onto the Line plays the Map, takes the
Tower and plays it. The positions those rollouts reach still score below an
unspent Map. The probe-free arm reads the Map 0.001 lower again.

**Why it is the Evaluation and not the horizon alone.** A rollout ends at the
start of the Bot's next turn (ADR 0015, `ROLLOUT_EXTRA_BOT_TURNS = 0`), and
the Line pays off only after Sylvan Scrying finds the Mine in the next turn's
main phase. The horizon is therefore what hides the payoff. A longer horizon
does not bring it back (§ 4: under `horizon-b` the gap halves and the Map
still loses on every seed). The only reader left is the Evaluation at the
leaf. That position holds Power Plant and Tower in play with Sylvan Scrying in
hand, one tutor from Tron, and the Evaluation reads it as worth less than the
Map left unused. This is the position-one-tutor-away case that PRD issue
#10849's Deck Needs columns are meant to read.

## 4. Two diagnostic arms (local, not part of the gate)

Each was run with `bun run blade:census` at three seeds. A census arm takes
one variant, so neither combines with the forced guide.

| variant                          | Line                   | budget | result                                                     |
| -------------------------------- | ---------------------- | ------ | ---------------------------------------------------------- |
| `no-rule:last-window-deferral`   | Amulet                 | 400    | first 3/3; stops at decision 7 on every seed               |
| `no-rule:last-window-deferral`   | Amulet, one mana short | 400    | red 3/3: casts the Pact                                    |
| `no-rule:last-window-deferral`   | Amulet                 | 94     | stops at decision 1 on every seed                          |
| `horizon-b` (score at next main) | Tron                   | 387    | stops at decision 1: Map 180 · 0.5338, `pass` 207 · 0.5387 |

With the rule off, the base search casts the Pact and the Titan. It stops at
the Titan's enter-the-battlefield search (decision 7): paying gets 201 visits
and declining gets 199, both at a mean reward of exactly 0.75, and the material
tiebreak declines. The reward is saturated, so it cannot tell two fetched lands
from none. That is the next stop past the rule, and its cause is the
Evaluation. It was read on the base search, not under the forced guide.

## 5. The probe-free ceiling

Iterations per second of search loop (`DecisionTrace.elapsedMs`), pooled over
every decision each arm ran on the four Lines at all four budgets, on the
hosted runners (4 workers per 4-vCPU VM):

| arm                      | iterations | iterations per second |
| ------------------------ | ---------- | --------------------- |
| base                     | 16,981     | 157                   |
| `forced-guide`           | 17,396     | 147                   |
| `forced-guide-no-probes` | 17,381     | 184                   |

Per Line at the declared budget the probe-free arm runs 189 (Amulet), 248
(one mana short), 200 (Tron) and 192 (Stone Rain) iterations per second,
against 115, 208, 167 and 146 under the forced guide with probes. On these
boards a rollout probes 0.2–1.8 candidates per iteration, so dropping the
probes buys 17–25% pooled. This matches `rollout-policy-cost.md` § 1: on
blade boards the policy is not where an iteration's time goes. The ceiling of
a guide that scores a move without simulating it is therefore about 1.2× on
these boards. The 3.1–6.1× of a late field board is not reached here.

These are hosted-runner milliseconds: a lab proxy for the trend
(`CENSUS_MS_NOTE`), never a field figure.

## 6. The `must` tier under both forced arms

`bun run blade:census --tier must` (every entry at its declared budget, every
seed) in three arms: base (run 45932427273), `forced-guide` (45932429851) and
`forced-guide-no-probes` (45932432492). There are 670 entries, 3,248 (entry,
seed) jobs, and the one `must` Line among them.

| arm                      | red entries | red seeds | new reds vs base |
| ------------------------ | ----------- | --------- | ---------------- |
| base                     | 0 / 670     | 0         | —                |
| `forced-guide`           | 0 / 670     | 0         | 0                |
| `forced-guide-no-probes` | 0 / 670     | 0         | 0                |

**The `must` tier did not move**, as the variant's design says it should. A
forced-guide arm binds only at a Line's decisions, so on every scenario entry
it resolves to the production search. The one `must` Line (hold the pump
through the upkeep) is followed to its end on 3 of 3 seeds in all three arms.

## 7. What it means for PRD issue #10849

The gate fails. Its failure is not a missing guide, so it names work that a
trained guide alone would not do:

- **Amulet:** a frozen root rule (ADR 0186 Decision 8, `ROOT_RULE_ALLOWLIST`)
  overrides a search that already found the Line. Retiring or narrowing it
  follows the bot rules' retirement proof (both `flipped` = 0 on the corpus
  and `must` green under `no-rule:last-window-deferral`). Past it, the next
  stop is a saturated reward at the Titan's search (§ 4).
- **Tron:** the Evaluation of a position one tutor from its payoff. The forced
  guide spent its visits and moved no value. This is the case the generated
  vector's Deck Needs columns are measured on in the Prototype gate.
