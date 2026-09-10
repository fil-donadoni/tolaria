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

## Corpus half — pending

Run: `bash scripts/greedy-corpus.sh` (three shards, ~1.5–2.5 h wall-clock).
Read `greedyAgreeShare`, `greedyAgreeByMechanism` and `greedyAgreeByMoveKind`
from each shard's `selfPlaySummary`; shard A also carries `bladeSummary`.
