# Greedy 1-ply policy vs the search (issue #3393)

**Question.** At the production budget, how much does the ISMCTS search add
over the 1-ply greedy policy it already contains? The decision telemetry
(issue #1893, issue #1929) says the search's mean reward decides 16.7–19.7% of
real root picks; the Walking Ballista chain (issue #3192 → #3319 → #3369 →
#3377) shows a line the 1-ply probe scores ~126 points worse than passing
being picked by the search anyway. If the greedy policy alone already holds
most of the correctness floor, the search is spending its budget re-deriving
(and sometimes degrading) what the policy knows, and the strength programme's
lever is the policy, not the tree.

**Method.** Two legs, both deterministic, no behaviour change.

1. **Blade half** —
   `BLADE_GREEDY=1 BLADE_GREEDY_WITH_SEARCH=1 BLADE_GREEDY_OUT=<path>.json bunx vitest run --config vitest.blade.config.ts convex/gre/ai/blade/__tests__/greedy-report.spec.ts`
   (module `convex/gre/ai/blade/greedyReport.ts`): every registry entry,
   every declared seed, decided twice on the identical position — by `greedyRootPick` (the rollout policy `selectRolloutMove`
   applied at the root over the same dominance-pruned `enumerateMoves` list,
   zero search) and by `searchWithTrace` at the entry's own `iterations`.
2. **Corpus half** — `bash scripts/greedy-corpus.sh`: the issue #1893
   self-play corpus (six pairings, three seed shards, 400 iterations) with a
   `greedyAgrees` field on every root-decision record: does the search's pick
   equal the greedy pick on the same root, split by the mechanism that
   decided the search's pick and by move kind.

Caveat shared by both legs: the greedy probe runs on the raw (headless,
full-information) state; the search determinizes it per iteration. In the
live client both see the wire projection. The comparison is over identical
candidate sets and seeds either way.

## Blade half — measured 2026-09-10 on the base tip after PR #3394

129 entries, 587 seeds. Greedy leg alone: 0.7 s. Both legs: 312 s.

| tier    | greedy entries | greedy seeds    | search entries | search seeds   |
| ------- | -------------- | --------------- | -------------- | -------------- |
| must    | 86/121 (71.1%) | 397/553 (71.8%) | 121/121 (100%) | 553/553 (100%) |
| stretch | 2/8 (25.0%)    | 9/34 (26.5%)    | 1/8 (12.5%)    | 2/34 (5.9%)    |

Entry agreement over all 129: both correct **87**, search-only **35**,
greedy-only **1** (a stretch Twin activation), neither **6**.

(A first run on the pre-#3394 tree, 126 entries, read 87/118 = 73.7% must
and 31 search-only; #3394's block lens moved two entries — the Wild Growth
cast variant and the Channel-funded Fireball — from greedy-ok to greedy-fail
and added the two informed/blind-defender entries, both search-only.)

By expected move kind (must + stretch), greedy → search:

| kind                                              | greedy         | search        |
| ------------------------------------------------- | -------------- | ------------- |
| predicate                                         | 21/26 (80.8%)  | 25/26 (96.2%) |
| cast-spell                                        | 11/25 (44.0%)  | 22/25 (88.0%) |
| activate-ability                                  | 13/17 (76.5%)  | 16/17 (94.1%) |
| forbidden:cast-spell                              | 14/17 (82.4%)  | 17/17 (100%)  |
| forbidden:activate-ability                        | 15/16 (93.8%)  | 16/16 (100%)  |
| resolution-choice                                 | 4/10 (40.0%)   | 9/10 (90.0%)  |
| declare-attackers                                 | 2/3            | 3/3           |
| declare-blockers                                  | 2/3            | 3/3           |
| forbidden:declare-attackers                       | 0/3            | 2/3           |
| forbidden:declare-blockers                        | 1/3            | 3/3           |
| activate-granted-ability                          | 0/1            | 1/1           |
| may-pay, play-land, turn-face-up, madness-decline | all 1/1 or 2/2 | same          |

### Reading

**The greedy policy alone holds seven tenths of the must floor** (71% of
entries, 72% of seeds) in under a second against the search's five minutes.
The search's 100% on `must` is by construction: every must entry was made
green by a change to the search, its tie-breaks or its priors, so
"search-only" is exactly the set of positions those changes were written for.

The 35 search-only must entries fall into four classes, read off what the
greedy leg picked:

| class                                          | entries | what the greedy pick did                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **passes when it should act**                  | 17      | Stomp, Stifle, Chalice removal, Salvager, re-type mode, shoot-last-counter, indestructible grant, hasty Kavu lethal, morph face-down, curve creature, Dark Ritual, storm kill ×2, self-tap source, genuine edict, Channel-funded Fireball, Liliana −2 (activates the wrong ability) |
| **combat it cannot read in one ply**           | 8       | battle-cry lethal, Glorybringer exert, wasteful 3/5 attack, informed-opponent attack, non-lethal chump, blind/informed defender ×2, Mishra after combat                                                                                                                             |
| **choice nodes with a prior the policy lacks** | 5       | protection colour ×3, scry, explore                                                                                                                                                                                                                                                 |
| **one-ply sees the wrong branch**              | 5       | modal BEB mode, Dreadnought pair (both halves), Kjeldoran Dead sacrifice sign, known-top cantrip, Wild Growth on its own land                                                                                                                                                       |

The first class is the largest and is the same bias the Ballista chain named
in issue #3377: the leaf evaluation charges every cast its card's latent hand
value and every tapped source `manaWeight`, so a one-ply view of "act" loses
to "pass" unless the payoff is big and immediate. The search rescues these
positions not by seeing further — most payoffs are one ply away — but through
`free-development`, `wasted-mana-hold`, the announcement probes and the
choice priors: hand-written policy, applied after the tree returns a tie.

**What this does and does not say.** It says the search adds ~29 points of
the must floor over the raw policy, and that most of those points come from
the root rules and priors rather than from depth. It does not yet say how
often the two disagree in real play, or whether the search's disagreements
are improvements — that is the corpus half.

## Corpus half — measured 2026-09-10 (run started 20:32, three shards)

`bash scripts/greedy-corpus.sh` (3 games per pairing per shard, seeds
1893 / 2893 / 3893, 400 iterations): 54 self-play games over the six
issue #1893 pairings, all decisive by life, **4 760 root decisions** with a
greedy field (single-candidate roots emit no record), plus the 129-entry
blade corpus (531 decisions, shard A). Raw JSON:
`ladder-runs/2026-09-10-20-32-greedy-concordance-{A,B,C}.json`.

**The search's pick equals the greedy pick in 63.1% of real decisions**
(3 002 / 4 760; shards 64.8% / 62.5% / 61.8%). On the blade positions,
59.3% (315 / 531).

By the mechanism that decided the search's pick (self-play):

| mechanism            | agree / total | share |
| -------------------- | ------------- | ----- |
| material-tiebreak    | 1543 / 2682   | 57.5% |
| mean-reward          | 657 / 919     | 71.5% |
| self-harm-removal    | 458 / 577     | 79.4% |
| free-development     | 186 / 291     | 63.9% |
| block-quality        | 32 / 71       | 45.1% |
| wasteful-attack      | 35 / 67       | 52.2% |
| wasted-mana-hold     | 41 / 50       | 82.0% |
| announcement-variant | 15 / 46       | 32.6% |
| standing-spend-hold  | 26 / 40       | 65.0% |
| hold-trick           | 9 / 16        | 56.2% |

By the kind of move the search chose:

| kind              | agree / total | share |
| ----------------- | ------------- | ----- |
| pass              | 1280 / 1723   | 74.3% |
| cast-spell        | 750 / 1179    | 63.6% |
| declare-attackers | 402 / 840     | 47.9% |
| play-land         | 445 / 782     | 56.9% |
| declare-blockers  | 107 / 192     | 55.7% |
| activate-ability  | 13 / 34       | 38.2% |

### Reading

- **56% of real decisions (2 682) reach the root as a tie** and are settled
  by the material tie-break; there the search and the greedy policy agree
  only 57.5% of the time — barely above what two noisy readings of the same
  evaluation would give. Where the search's own reward decided (19%), they
  agree 71.5%.
- **Attack declarations and land plays are where they disagree most** (48%
  and 57%): both are multi-candidate roots (which attackers, which land)
  whose candidates the evaluation scores identically, so each decider breaks
  the tie its own way. Disagreement there is mostly not a preference.
- **The concordance cannot say who is right.** The blade half can: on the
  judged positions the search holds 100% of `must` against the greedy
  policy's 71%, and the greedy-only set is one stretch entry. So the search
  is not merely re-deriving the policy — on the positions a human has
  judged it adds 29 points, most of them through the root rules and choice
  priors.

### Verdict on the policy-first question

**Not supported as a replacement.** The greedy policy is a cheap, strong
floor (71% of `must` in under a second) and a one-second regression
instrument, but the search adds real correctness on judged positions, and
in real play the two disagree on 37% of decisions with no evidence about
which side is right. The lever this measurement points at is the same one
the blade half named: the evaluation's own exchange rates (17 of the 35
search-only entries are the act-versus-hold bias of issue #3377; Stone Rain
loses 205 margin points at announcement). That is ADR 0124 and PRD #3397 —
fit the evaluation from player Verdicts, re-measure the greedy floor, and
revisit the root decider only once the value function is right. The greedy
report (`BLADE_GREEDY=1`) and this corpus (`scripts/greedy-corpus.sh`) are
the before/after instruments.
