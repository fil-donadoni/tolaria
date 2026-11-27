# Held-out Agreement on the enlarged exam: today's Bot, before anything changes (issue #10855, ADR 0186)

> **Measured at** 2026-11-27 on base `b9549cbb4` (`origin/staging`), with the
> Verdict Lock this note's PR commits: 188 verdicts, pack
> `90ef7f4dfd94daa6e3f5db76c944c4ca5c36f55c7bee7702fc226671d026c0e8`,
> `DEFAULT_EVAL_WEIGHTS` unchanged (`weights moved: 0`). Commands:
> `bun run verdicts:exam` against the Verdict Store, then
> `bun run verdicts:pick-agreement` (400 iterations × 5 seeds per verdict).
> Every later gate of PRD issue #10849 is read against these numbers. Re-run
> before quoting them against a later Bot.

**Question.** ADR 0186 Decision 7 makes the player Verdicts the exam until the
Prototype gate is read. The held-out side had 24 verdicts, too few to tell one
Bot from another. How does today's Bot do on the exam once every promotable
player Verdict is on it?

**Verdict up front: the exam is now n = 111, and today's Bot picks the
player's move on every seed in 51 of them (45.9%). The Evaluation alone orders
367 of 449 exam pairs as the player did (81.7%).** The hash side alone reads
15/24, one more than the last reading (14/24, 2026-10-11). The rule side, 87
verdicts the Weight Fit has never read, is harder: 36/87 = 41.4%. Only the two
totals clear n = 100, plus the `pass` class on eval agreement. Every
per-class pick number is still indicative.

## How the exam was filled

`bun run verdicts:exam` (issue #10851) read the Verdict Store and found 192
objects, 188 of them promotable:

- 3 invalid: a `cast Deathrite Shaman` candidate the rebuilt position no longer
  enumerates.
- 1 incomplete pair: a Conditional Verdict on Serra's Sanctum with no
  right-hand half (ADR 0148).

None of the four was locked, so nothing already locked had to move. All 87
promotable verdicts the lock did not name entered it on the exam side
(`examIds`). The lock went from 101 to 188, and the old 101 kept their order.
The fit re-run over the widened lock reproduced the committed weights byte for
byte. No promotable verdict was left out and none was burned, so the exam
holds 24 verdicts on the hash side and 87 on the rule side.

The issue expected about 98: on 2026-11-26 the store held 184 objects, 175 of
them promotable, which left 74 for the exam. By 2026-11-27 it held 192 objects,
188 of them promotable, so 13 more verdicts reached the exam.

## Pick agreement: does the whole Bot play the player's move?

A verdict agrees only when **every** seed picks an allowed candidate or an
accepted alternative. `seeds` counts the seeds that did.

| Decision Class    | hash side | rule side | total      | seeds (total) |
| ----------------- | --------- | --------- | ---------- | ------------- |
| activate          | 0/1       | 3/9       | 3/10       | 15/50         |
| cast              | 3/6       | 9/18      | 12/24      | 63/120        |
| declare-attackers | 1/1       | 7/13      | 8/14       | 45/70         |
| declare-blockers  | —         | 3/6       | 3/6        | 15/30         |
| land-drop         | 5/9       | 4/17      | 9/26       | 62/130        |
| optional-payment  | —         | 0/2       | 0/2        | 5/10          |
| pass              | 6/7       | 10/20     | 16/27      | 87/135        |
| resolution-choice | —         | 0/2       | 0/2        | 3/10          |
| **all**           | **15/24** | **36/87** | **51/111** | **295/555**   |
| share             | 62.5%     | 41.4%     | **45.9%**  | 53.2%         |

The run's own split: timing verdicts 18/44 (40.9%), everything else 33/67
(49.3%). It searched all 111 verdicts with 0 unsearchable, 0 Indifferent and 0
burned.

**Seed spread.** 95 of the 111 verdicts give the same answer on all five seeds:

| seeds that agree | verdicts |
| ---------------- | -------- |
| 5/5              | 51       |
| 4/5              | 4        |
| 3/5              | 4        |
| 2/5              | 4        |
| 1/5              | 4        |
| 0/5              | 44       |

The 16 mixed verdicts bound how far the seed can move the number. A Bot read
on one seed alone would agree on between 51 and 67 verdicts (45.9%–60.4%), and
the seed-averaged rate is 295/555 = 53.2%. A later Bot that moves the strict
count by fewer than about 16 has not been shown to differ.

The run failed on wall-clock alone. The test finished after 3786 s and its
block printed in full, but the old 60-minute cap marked it as a timeout. The
machine had a load average of about 18 on 8 cores, and other sessions were
gating. This PR raises the cap to 3 hours. The run is deterministic (fixed
iterations and seeds), so the block above is the one a clean exit would print.

## Eval agreement: does the Evaluation alone order the pairs as the player did?

Pairs, not verdicts: one verdict gives a pair per rejected candidate. Timing
pairs are left out because they are not agreement evidence: 24 on the hash
side and 94 on the rule side, 118 in all.

| Decision Class    | hash side | rule side   | total       |
| ----------------- | --------- | ----------- | ----------- |
| activate          | 0/1       | 24/36       | 24/37       |
| cast              | 16/21     | 37/44       | 53/65       |
| declare-attackers | 1/1       | 49/64       | 50/65       |
| declare-blockers  | —         | 72/76       | 72/76       |
| land-drop         | 13/21     | 23/32       | 36/53       |
| optional-payment  | —         | 1/2         | 1/2         |
| pass              | 1/1       | 130/144     | 131/145     |
| resolution-choice | —         | 0/6         | 0/6         |
| **all**           | **31/45** | **336/404** | **367/449** |
| share             | 68.9%     | 83.2%       | **81.7%**   |

The total is what `verdicts:exam` printed. The per-side split was read with a
throwaway test over the same corpus, the same weights and the same side map,
filtering the report's pairs by side. Its total matched the printed one pair
for pair.

## What this says, and what it does not

- **The gap between the two counts is the search's.** On the rule side the
  Evaluation orders 83.2% of the pairs right, yet the whole Bot plays the
  player's move in only 41.4% of the verdicts. The two numbers count different
  units (pairs against verdicts, and a verdict needs every one of its pairs and
  every seed), so the gap is not a pure search cost. It is still large enough
  to say that ordering the pairs right is far from playing the move.
- **`land-drop` is the weakest class with any n.** Pick agreement is 9/26, and
  4/17 on the rule side, even though eval agreement is 36/53.
- **Too thin to read**, by the reporting rule that n < 100 is indicative:
    - Pick agreement: every class, the largest being `pass` with n = 27. Only the
      total (111) is readable.
    - Eval agreement: every class except `pass` (n = 145). `optional-payment`
      (2 pairs) and `resolution-choice` (6 pairs, 0 agreed) are anecdotes.
    - Per side: the hash side (24 verdicts, 45 pairs) alone reads nothing.
      Quote it only to compare with its own earlier readings.
- **No weight moved and nothing was promoted.** The fit side is the 101
  verdicts it was before. `verdicts:promote` stays refused until the Prototype
  gate is read (issue #10851).
