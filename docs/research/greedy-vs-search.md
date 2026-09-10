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

1. **Blade half** — `bun scripts/blade-greedy.ts --tier all --with-search`:
   every registry entry, every declared seed, decided twice on the identical
   position — by `greedyRootPick` (the rollout policy `selectRolloutMove`
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

## Blade half — measured 2026-09-10 (worktree of PR for issue #3393)

126 entries, 572 seeds. Greedy leg: 2.6 s. Search leg: 565 s.

| tier    | greedy entries | greedy seeds    | search entries | search seeds   |
| ------- | -------------- | --------------- | -------------- | -------------- |
| must    | 87/118 (73.7%) | 402/538 (74.7%) | 118/118 (100%) | 538/538 (100%) |
| stretch | 2/8 (25.0%)    | 9/34 (26.5%)    | 1/8 (12.5%)    | 2/34 (5.9%)    |

Entry agreement over all 126: both correct **88**, search-only **31**,
greedy-only **1** (a stretch Twin activation), neither **6**.

By expected move kind (must + stretch), greedy → search:

| kind                                                                                          | greedy         | search        |
| --------------------------------------------------------------------------------------------- | -------------- | ------------- |
| predicate                                                                                     | 21/26 (80.8%)  | 25/26 (96.2%) |
| cast-spell                                                                                    | 11/25 (44.0%)  | 22/25 (88.0%) |
| activate-ability                                                                              | 13/17 (76.5%)  | 16/17 (94.1%) |
| forbidden:cast-spell                                                                          | 15/17 (88.2%)  | 17/17 (100%)  |
| forbidden:activate-ability                                                                    | 15/16 (93.8%)  | 16/16 (100%)  |
| resolution-choice                                                                             | 4/10 (40.0%)   | 9/10 (90.0%)  |
| declare-attackers                                                                             | 2/3            | 3/3           |
| forbidden:declare-attackers                                                                   | 0/3            | 2/3           |
| forbidden:declare-blockers                                                                    | 1/2            | 2/2           |
| may-pay, play-land, declare-blockers, activate-granted-ability, turn-face-up, madness-decline | all 1/1 or 2/2 | same          |

### Reading

**The greedy policy alone holds three quarters of the must floor** (74% of
entries, 75% of seeds) in 2.6 seconds against the search's 565. The search's
100% on `must` is by construction: every must entry was made green by a
change to the search, its tie-breaks or its priors, so "search-only" is
exactly the set of positions those changes were written for.

The 31 search-only must entries fall into four classes, read off what the
greedy leg picked:

| class                                          | entries | what the greedy pick did                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **passes when it should act**                  | 16      | Stomp, Stifle, Chalice removal, Salvager, re-type mode, shoot-last-counter, indestructible grant, hasty Kavu lethal, morph face-down, curve creature, Dark Ritual, storm kill ×2, self-tap source, genuine edict, Liliana −2 (activates the wrong ability) |
| **combat it cannot read in one ply**           | 6       | battle-cry lethal, Glorybringer exert, wasteful 3/5 attack, informed-opponent attack, non-lethal chump, Mishra after combat                                                                                                                                |
| **choice nodes with a prior the policy lacks** | 6       | protection colour ×3, scry, explore, Chrome Mox (stretch)                                                                                                                                                                                                  |
| **one-ply sees the wrong branch**              | 3       | modal BEB mode, Dreadnought pair (both halves), Kjeldoran Dead sacrifice sign, known-top cantrip                                                                                                                                                           |

The first class is the largest and is the same bias the Ballista chain named
in issue #3377: the leaf evaluation charges every cast its card's latent hand
value and every tapped source `manaWeight`, so a one-ply view of "act" loses
to "pass" unless the payoff is big and immediate. The search rescues these
positions not by seeing further — most payoffs are one ply away — but through
`free-development`, `wasted-mana-hold`, the announcement probes and the
choice priors: hand-written policy, applied after the tree returns a tie.

**What this does and does not say.** It says the search adds ~26 points of
the must floor over the raw policy, and that most of those points come from
the root rules and priors rather than from depth. It does not yet say how
often the two disagree in real play, or whether the search's disagreements
are improvements — that is the corpus half.

## Corpus half — pending

Run: `bash scripts/greedy-corpus.sh` (three shards, ~1.5–2.5 h wall-clock).
Read `greedyAgreeShare`, `greedyAgreeByMechanism` and `greedyAgreeByMoveKind`
from each shard's `selfPlaySummary`; shard A also carries `bladeSummary`.
