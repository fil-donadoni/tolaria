# Judge gate: a language model against the Brain and the Greedy Pick (issue #10858, ADR 0186)

> **Measured at** 2026-11-28, 15:22–16:32 Rome, on positions built at
> `31a1ecb5d` (`origin/staging`). The Verdict Lock is the one from
> `held-out-agreement-enlarged-exam-baseline.md`: 188 verdicts, pack
> `90ef7f4d…c0e8`, 111 on the exam side. The models were `claude-opus-5-5`,
> `claude-fable-5-2` and `claude-sonnet-5-5`, called through `claude -p` with
> `--effort high`. The Brain's numbers are the baseline note's, not re-run.
> The script is a scratch file and was not committed. Re-run before quoting
> these numbers against a later Bot, a later lock or a later model.

**Question.** ADR 0186 Decision 6 lets a **Synthetic Verdict** teach the
**Evaluation** only where a language model is measured to judge better than
the **Brain**. Does it, and on which **Decision Classes**?

**Verdict up front.** Under the pass rule the owner confirmed before the
first run, every model clears the `must` tier (90.9–91.4%). The classes
admitted per model are:

| model  | activate | cast | declare-attackers | land-drop | pass |
| ------ | -------- | ---- | ----------------- | --------- | ---- |
| Opus   | PASS     | PASS | PASS              | PASS      | PASS |
| Fable  | PASS     | PASS | PASS              | PASS      | fail |
| Sonnet | PASS     | fail | fail              | PASS      | fail |

`declare-blockers`, `optional-payment` and `resolution-choice` have fewer than
ten exam Verdicts, so this measurement admits none of them.

**Only two admissions are robust: `land-drop` and `activate`, for all three
models.** Opus passes `cast`, `declare-attackers` and `pass` by 11–12 points.
That margin is about one standard error of a class of 14–27 verdicts, and in
`declare-attackers` it is smaller than Opus's own pass-to-pass spread (10 to 12
of 14). On `cast` the **Greedy Pick** alone scores 66.7%, above Opus (63.9%).
The rule admits those three classes, but the evidence for them is thin.

## The pass rule

Confirmed by the owner on 2026-11-28 before any run, and posted on issue #10858:

1. Only a Decision Class with at least ten exam Verdicts is eligible.
2. The comparator is the Brain's **seed-averaged** pick agreement for that
   class (agreeing seeds over 5 × n). The model's number is its agreement
   averaged over its passes: Opus over 3, Fable and Sonnet over 1.
3. A class passes when the model beats that comparator by at least 10 points.
4. On the `must` tier, one pass per model, the model must pick an allowed
   move on at least 90% of the positions. A model under 90% admits no class.
5. The reasoning budget is `--effort high` for every model and every position.

## How each position was put to the model

- **Positions.** The exam positions are the 111 held-out verdicts
  (`heldOutVerdicts`), rebuilt with `buildVerdictState`. Their candidates are
  the recorded ones, resolved by `resolveVerdictMoves`, and they agree through
  `agreesWithVerdict`, exactly as `searchVerdict` grades the Brain.
- **`must` tier: 674 entries, 621 positions put to the model.**
    - 621 positions were rendered. 53 entries were not: 50 offer a single
      candidate and 3 are forced own-hand discards, so none of them is a
      decision.
    - The candidates are `candidateMoves`.
    - A pick is graded by the entry's own expectation (`moves`, `forbidden` or
      the `predicate`), so the 173 predicate entries the verdict lowering drops
      are still graded.
    - In 38 positions every candidate is allowed. They are left out of the 90%
      (583 positions remain).
- **Candidates.**
    - Interchangeable twins (`makeInterchangeableKeyer`) are shown once, as the
      Bot's own candidate set collapses them (3 positions).
    - Candidates whose text was otherwise identical carry the field they differ
      in: the attack target, the mana tapped, or which copy of a card.
- **Board.**
    - The board is rendered from `projectPublicState` for the deciding seat, the
      projection a client receives and the Brain reads in play.
    - The model sees its own hand. The opponent's hand appears as a count,
      except the cards a pending choice shows the chooser.
    - Libraries appear as counts, plus the cards the seat legitimately knows (a
      known top, a library being searched).
    - Every public zone is shown, with P/T read through the layers
      (`getEffectivePT`), counters, attachments, combat, the stack, the pending
      choice and its options, and the turn's facts (revolt, deaths, life gained
      and lost, cards drawn, spells cast).
    - Then comes the Oracle text of every card named, plus the decklist the
      entry's `deckKnowledge` grants.
    - Nothing the Brain is not granted was shown.
- **The model process.**
    - It ran from an empty directory outside the repository, with
      `--tools ""`, `--setting-sources ""`, `--strict-mcp-config` and
      `--no-session-persistence`.
    - It received one fixed system prompt ("choose the candidate that gives you
      the best chance of winning").
    - It answered through a JSON schema: a candidate number and three to five
      Factors.
    - A probe confirmed the process saw no tools, no hook output, no CLAUDE.md
      and no memory.
- **Checks before any number.**
    - Fifteen rendered prompts were read by hand against their positions.
    - On all 111 exam positions a script compared every rendered zone, card by
      card, with the Scenario Spec. Two positions differ, both legitimately: the
      rendered exile holds the prepared copy of Ancestral Recall that Emeritus
      of Ideation creates, which the spec does not list.
    - The hand reading found defects: raw instance ids, unnamed choice options,
      ambiguous twins, and stack items not labelled as abilities. They were
      fixed before the first run.

**One defect was found after the first full run, and fixed.**

- **The defect.** The prompts left out the turn's facts and printed a known
  library card as "unknown". A `must` entry on Fatal Push with revolt showed
  it: all three models declined, citing "revolt not enabled".
- **The re-run.** The fix changed 262 prompts (105 exam, 157 `must`). Every
  run was re-asked on exactly those positions, and the tables below are the
  second run.
- **What it moved.**
    - Opus's exam total did not move: 237/333 both times.
    - Four class verdicts flipped from pass to fail: Fable on `pass` (+13.3 to
      +9.6), Sonnet on `cast` (+18.3 to +1.7), Sonnet on `declare-attackers`
      (+14.3 to +7.1) and Sonnet on `pass` (+13.3 to +9.6).
    - So a single-pass model's class verdict near the line moves by the
      rendering alone. Treat it as provisional.

## Exam agreement

Brain and Greedy are seed-averaged (5 seeds per verdict). A model cell counts
picks over its passes.

| Decision Class    | n   | Brain             | Greedy Pick       | Opus (3 passes)   | Fable (1)        | Sonnet (1)       |
| ----------------- | --- | ----------------- | ----------------- | ----------------- | ---------------- | ---------------- |
| activate          | 10  | 15/50 30.0%       | 15/50 30.0%       | 19/30 63.3%       | 7/10 70.0%       | 6/10 60.0%       |
| cast              | 24  | 63/120 52.5%      | 80/120 66.7%      | 46/72 63.9%       | 16/24 66.7%      | 13/24 54.2%      |
| declare-attackers | 14  | 45/70 64.3%       | 42/70 60.0%       | 32/42 76.2%       | 13/14 92.9%      | 10/14 71.4%      |
| declare-blockers  | 6   | 15/30 50.0%       | 19/30 63.3%       | 10/18 55.6%       | 3/6 50.0%        | 4/6 66.7%        |
| land-drop         | 26  | 62/130 47.7%      | 61/130 46.9%      | 65/78 83.3%       | 23/26 88.5%      | 23/26 88.5%      |
| optional-payment  | 2   | 5/10 50.0%        | 5/10 50.0%        | 3/6 50.0%         | 1/2 50.0%        | 1/2 50.0%        |
| pass              | 27  | 87/135 64.4%      | 85/135 63.0%      | 62/81 76.5%       | 20/27 74.1%      | 20/27 74.1%      |
| resolution-choice | 2   | 3/10 30.0%        | 0/10 0.0%         | 0/6 0.0%          | 0/2 0.0%         | 0/2 0.0%         |
| **all**           | 111 | **295/555 53.2%** | **307/555 55.3%** | **237/333 71.2%** | **83/111 74.8%** | **77/111 69.4%** |

**The Greedy Pick was not measured before.** It is `greedyRootPick` on each
exam position at the five exam seeds, matched to a candidate the way
`searchVerdict` matches the search's pick.

- It does not determinize: it reads the built state. The exam specs deal the
  opponent's hand as placeholders (`hiddenHand`), so it has no hidden card to
  read.
- At 55.3% it edges the full Brain (53.2%).
- On `cast` it gains 14 points over the Brain (66.7% against 52.5%), so there
  the search costs agreement.

**Opus pass to pass.** The three passes scored 79, 77 and 81 of 111.

| class             | n   | pass 1 | pass 2 | pass 3 |
| ----------------- | --- | ------ | ------ | ------ |
| activate          | 10  | 6      | 6      | 7      |
| cast              | 24  | 16     | 15     | 15     |
| declare-attackers | 14  | 10     | 10     | 12     |
| land-drop         | 26  | 22     | 21     | 22     |
| pass              | 27  | 20     | 21     | 21     |

- Opus picks the same candidate on all three passes in 97 of 111 positions.
- It agrees on every pass in 74 of 111 (66.7%). The Brain's strict
  all-seeds count is 51 of 111.
- All five runs agree with the player on 71 positions, and none agrees on 25.

## The `must` tier

| class             | n (non-trivial) | Greedy (seed-avg) | Opus            | Fable           | Sonnet          |
| ----------------- | --------------- | ----------------- | --------------- | --------------- | --------------- |
| activate          | 111             | 77.5%             | 105 (94.6%)     | 102 (91.9%)     | 103 (92.8%)     |
| cast              | 295             | 77.4%             | 266 (90.2%)     | 267 (90.5%)     | 267 (90.5%)     |
| declare-attackers | 29              | 69.0%             | 27 (93.1%)      | 28 (96.6%)      | 26 (89.7%)      |
| declare-blockers  | 19              | 64.2%             | 17 (89.5%)      | 16 (84.2%)      | 17 (89.5%)      |
| land-drop         | 8               | 62.5%             | 8               | 8               | 8               |
| mixed             | 10              | 69.2%             | 9               | 10              | 8               |
| optional-payment  | 11              | 81.8%             | 10              | 10              | 10              |
| pass              | 26              | 73.1%             | 20 (76.9%)      | 20 (76.9%)      | 19 (73.1%)      |
| protocol          | 11              | 54.5%             | 11              | 11              | 11              |
| resolution-choice | 46              | 72.6%             | 43 (93.5%)      | 43 (93.5%)      | 44 (95.7%)      |
| targeting         | 17              | 76.5%             | 17              | 17              | 17              |
| **all**           | **583**         | **75.3%**         | **533 (91.4%)** | **532 (91.3%)** | **530 (90.9%)** |

- The search passes every `must` entry by construction, since the tier gates
  the queue.
- Counting the 38 trivial positions, the models score 571, 570 and 568 of 621.
- All three models clear 90%, by 0.9 to 1.4 points: four or five positions.
- **Every model misses the same 32 positions.**
    - Read by their labels, with the Factors of a sample, nearly all are the Bot's entry pinning a narrower property
      than "best play". The model plays a sound alternative instead: it holds an
      instant or a flash creature for the opponent's turn ("Terror is an
      instant, keep it for their turn"), or casts the hasty threat into a known
      lethal line.
    - The `pass` class (26 entries, about 75% for every model) is where the
      `must` tier and a strong player most often part ways. Those entries pin
      holding an answer or not spending a resource.
    - This is a reading of the tier's authoring as much as of the model.

## Cost of judging at volume

The `must` positions are smaller boards, so they cost about half as much as
the exam positions.

| run         | positions | input tokens p50 / mean | output tokens p50 / mean | list USD per position | s per call p50 |
| ----------- | --------- | ----------------------- | ------------------------ | --------------------- | -------------- |
| Opus exam   | 3 × 111   | 3510 / 4212             | 818–852 / 968–1013       | 0.021–0.047           | 11.5           |
| Fable exam  | 111       | 3510 / 4212             | 788 / 1246               | 0.105                 | 11.7           |
| Sonnet exam | 111       | 3514 / 4216             | 756 / 938                | 0.023                 | 7.3            |
| Opus must   | 621       | 1994 / 2072             | 576 / 646                | 0.024                 | 8.7            |
| Fable must  | 621       | 1994 / 2072             | 424 / 605                | 0.045                 | 7.6            |
| Sonnet must | 621       | 1998 / 2076             | 534 / 618                | 0.012                 | 5.5            |

- Output tokens include thinking.
- Opus's first exam pass paid the prompt-cache writes (0.047 per position)
  that its later passes read (0.021).
- At these rates, 10 000 Synthetic Verdicts on exam-sized boards cost about
  $210 with Opus at list price, and a few hours of wall clock at four calls in
  flight.

## Factors the models named

There were 10 985 Factors over the eight runs. The theme tally is a keyword
match, so one Factor can hit several themes:

| theme                           | share of Factors |
| ------------------------------- | ---------------- |
| board / creatures               | 23.9%            |
| hidden information, held tricks | 20.3%            |
| mana and tempo                  | 19.7%            |
| life total, the race            | 13.1%            |
| sequencing                      | 11.6%            |
| card advantage                  | 8.4%             |
| lethal                          | 6.9%             |
| removal and threats             | 5.4%             |
| graveyard                       | 2.7%             |

- The most frequent words are hand, mana, only, empty, life, board, cards,
  damage, land and lethal.
- **For the crossings of columns to generate:** the models lean on three
  things.
    - The opponent's hand size and what it can hold ("empty hand", "no cards to
      answer").
    - Mana left untapped against what it can buy this turn.
    - The life race.
- Those are the crossings to try first: hidden-hand size × held instant,
  open mana × castable threat, and life × clock.

## What this says, and what it does not

- **The admissions are the rule's, read literally.**
    - For Opus: `activate`, `cast`, `declare-attackers`, `land-drop`, `pass`.
    - For Fable: all of those but `pass`.
    - For Sonnet: `activate` and `land-drop`.
    - The `must` floor held for all three.
- **Robust: `land-drop` and `activate`.** In `land-drop` the models lead the
  Brain by 35 to 41 points, the largest and steadiest gap here (Opus 21–22 of
  26 on every pass). The Brain's 47.7% in that class is its weakest with any n
  (the baseline note says so too).
- **Thin: `cast`, `declare-attackers`, `pass`.**
    - Each passes for Opus by 11–12 points, about one standard error.
    - In `cast` the Greedy Pick alone matches the models. There a Synthetic
      Verdict would teach the Evaluation little that removing the search's cost
      would not.
- **Not measured: `declare-blockers`, `optional-payment`,
  `resolution-choice`.** Each has fewer than ten exam Verdicts.
- **Whose move is right is still the player's.** Agreement here is with the
  player's move. A model that disagrees with the player is counted wrong even
  where its line is defensible, the same scoring the Brain gets.
- **Nothing entered the fit.** No Synthetic Verdict was produced, no weight
  moved, and the lock is unchanged.
