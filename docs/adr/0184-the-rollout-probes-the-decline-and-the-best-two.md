# The rollout probes the decline and the best two, never every candidate

## Status

accepted (2026-11-22, owner ruling on issue #10134, recorded in
`docs/research/rollout-policy-cost.md` § 6; implemented by issue #10473,
PRD issue #10017). Amends [ADR 0021](0021-stronger-opponent-model-and-temporal-flexibility.md)
§ 2: its greedy 1-ply default policy stands, but it no longer probes every
candidate of a rollout ply. [ADR 0015](0015-rollout-terminates-at-turn-boundary.md)'s
horizon is untouched.

## Context

At every rollout ply with a real choice, the default policy of ADR 0021
(`selectRolloutMove`) cloned the state, applied, settled and evaluated
**every** candidate before playing one. On four late-game production boards
those probes were 62–73% of a search: 7–12 probing plies per rollout, 5–8
candidates each (`rollout-policy-cost.md` § 1, `f98284f5b`, 2026-11-22). The
note measured cheaper policies against it: probing `pass` plus the best K − 1
by a static per-move-kind rank (`topk:K`) made an iteration 1.6–2.4× faster on
those boards at K = 3 and flipped none of the 574 searched `must` entries at
their declared budgets; K = 2 lost a tested decision in every arm, K = 4 was
slower and kept no more (§§ 2–3). The owner ruled for K = 3 (§ 6).

## Decision

1. **Inside a rollout, a ply with more than `ROLLOUT_PROBE_CAP` = 3
   candidates probes three**: the ply's decline and the best two of the rest
   (`rolloutProbeCandidates`, `convex/gre/rolloutProbeCut.ts`). A ply with
   three or fewer is probed whole, as before.
2. **The decline is never cut.** It is `pass`, or, on a declaration ply,
   which offers no `pass`, the empty attack or block declaration. The note's
   bench ranked the empty declaration just above `pass` but let it fall to
   the cut.
3. **"Best" is three keys, in order.**
    - **The move-kind rank the note measured**: land > cast > activation /
      attack / block > turn face up / foretell / plot / companion > other.
      What kind of move it is, never a card (ADR 0102).
    - **Between equal kinds, the widest declaration of a declaration ply.**
      On a declaration ply every candidate is one kind, so the kind rank says
      nothing, and the power set enumerates the single attackers first and
      the full attack last. In enumeration order alone no mover with two
      creatures probes attacking with both, and no defender a double block:
      the Bot's own alpha strike and the opponent's lethal crack-back both
      leave the playouts.
    - **On an attack ply, the strongest creature attacking alone**, then
      enumeration order. The other end of the same ply: one creature swings
      and the rest stay home. The power set reaches the first listed
      creature's lone attack only after every declaration of the others, so
      without this key a pumped creature attacking on its own is never
      probed. Read off the attacker's power as the layers give it (what the
      move does, never a card), once per lone attack of the ply.

    An attack ply's three probes are therefore nobody, the strongest
    creature alone, and everybody.

4. **Only the rollout's use.** The greedy pick's other readers probe every
   candidate as before: `greedyRootPick` (the blade's greedy leg), the
   greedy-concordance key in `searchWithTrace`, and `controlledSeatPick`
   (CR 723.5, ADR 0181).
5. **No draw, no table.** The cut reads the ply's list, and on an attack ply
   the power of each lone attacker: the same ply keeps the same moves, and
   the rollout's random stream is consumed exactly as before the cut.

## Considered and measured

Every arm went through `blade:census` (the `must` tier, every entry's own
seeds, against `d629e2b3d9`, 2026-11-22). A cell is new red entries (seeds) /
fixed entries; the base has 31 red entries at 94 iterations and 8 at 236,
none at the declared budgets. The first five arms also ranked a copy of a
kept play last (`collapseInterchangeableMoves`, issue #3593).

| between equal kinds                      | copies last | declared  | 94 iterations | 236 iterations |
| ---------------------------------------- | ----------- | --------- | ------------- | -------------- |
| by lot, every ply                        | yes         | 2 new red | 4 (6) / 7     | 3 (4) / 1      |
| enumeration order (the note's bench)     | yes         | 0         | 5 (9) / 2     | 4 (8) / 1      |
| the search's own probe history           | yes         | 0         | 4 (5) / 2     | 3 (7) / 1      |
| by lot, declaration plies only           | yes         | 0         | 5 (7) / 2     | 3 (4) / 0      |
| widest declaration, then enumeration     | yes         | 0         | 3 (4) / 2     | 3 (3) / 1      |
| **widest declaration, then enumeration** | **no**      | **0**     | **4 (5) / 2** | **2 (2) / 0**  |

- **A lot on every ply** reds two `must` entries at their declared budgets
  (a Fatal Push and a Blood Moon cast, each green again without the lot):
  among cast variants of one spell, enumeration order kept the right one in
  every playout and the lot only in some.
- **The search's probe history** (a move's mean regret against the best
  probe of its ply, optimistic for a move never probed: the move-average
  family of Finnsson and Björnsson's MAST) buys no decision the enumeration
  order loses and costs 6–9% of an iteration in move keys, on the field board
  below.
- **Enumeration order** reds "linked exile: Emperor of Bones adapts in the
  beginning-of-combat step once Atraxa is exiled with it" on 3 seeds at 94
  iterations and 5 at 236. The reanimated Atraxa must attack, and with two
  creatures on the battlefield the full attack is never probed. The widest
  declaration keeps that entry green at both budgets, with the copies rule
  and without it. It is the one difference between the arms that has a
  mechanism.
- **Copies last** buys nothing the census can read (the last two rows are
  inside each other's dice) and is the cut's only work that is not free: on
  the field board below it read level over a search's first 60 iterations
  and 0.07 of the base's time dearer over the first 20, on a loaded
  machine. Left out.
- **Everything else is inside the dice.** The note's `reseed` arm moves 6
  entries and fixes 7 at 94 iterations with nothing changed but the stream.

**The attack ply (2026-11-23, against `badd9fe601`).** The census above could
not see one thing: the queue's lane went red on two Bot-play sweep fixtures
(Phytoburst, Unnatural Speed). On a three-creature attack ply the first
hand-off probed the empty attack, the first lone attacker enumerated and the
full attack; the pumped creature attacking alone had left the playouts. Three
readings per arm: the eight sorcery-pump and ability-grant fixtures of the
sweep over 12 seeds and both seats at its 48 iterations (192 searches, the
card played in how many); the Atraxa entry above over its 7 seeds, run in
isolation at 94 and at 236 iterations; and the census as before.

| an attack ply keeps                         | sweep, of 192 | Atraxa, 94 / 236 | declared | 94 iterations | 236 iterations |
| ------------------------------------------- | ------------- | ---------------- | -------- | ------------- | -------------- |
| every candidate, no cut on any ply          | 173           | 7 / 7            | base     | base          | base           |
| empty, first lone enumerated, widest        | 143           | 7 / 7            | above    | above         | above          |
| **empty, strongest lone, widest (shipped)** | **161**       | **7 / 6**        | **0**    | **3 (4) / 2** | **2 (2) / 0**  |
| empty, every lone, widest                   | 169           | 6 / 4            | 0        | 3 (4) / 2     | 2 (4) / 0      |
| every attack (attack plies left uncut)      | 169           | not run / 5      | not run  | not run       | not run        |
| enumeration order                           | not run       | not run / 2      | above    | above         | above          |

- **The first hand-off's row** fails the two fixtures at the sweep's own two
  seeds, which is what the lane read. Its census is the last row of the
  table above.
- **Every lone attacker** (one probe per creature plus two, no state read)
  plays the sweep's cards as often as leaving attack plies uncut, and loses
  the Atraxa entry on 3 of 7 seeds at 236 iterations: handed every lone
  attack beside the full one, the greedy pick takes a lone attack where the
  entry needs both creatures. More probes on the attack ply are not a better
  attack.
- **The strongest lone attacker** keeps both: the two fixtures are green, the
  Atraxa entry holds on every seed at 94 iterations and on 6 of 7 at 236, and
  the ply stays at three probes whatever the board's width.

The literature agrees on the two points that decided: a subset choice
(attackers, blockers) is where limited structure pays in Magic, and a
playout that is deterministic in every choice loses to one that keeps some
randomness (Cowling, Ward and Powley 2012, on Magic itself). The rollout's
own epsilon branch is that randomness and is untouched.

## Consequences

- **Speed.** Against `badd9fe601`, on the MacBook (Apple M1 Pro, load
  average 10–144 from other sessions), 2026-11-23. On the 53 searched blade
  positions of the bench (`compare.mjs`, 200 iterations) an iteration takes
  0.919 and 0.944 of the base's CPU time at the median in two runs (p10 0.806
  and 0.847, p90 1.017 in both). On the field board `jh71n516` of the note it
  takes 0.46 of every-candidate probing over a search's first 20 iterations
  and 0.52 over 60, where the note's `topk:3` reads 0.43 and 0.53 in the same
  runs. The lone attacker's power read does not show: the first hand-off,
  without it, read 0.46 and 0.53 beside it.
- **The rollout's random stream is consumed as before.** Decisions still
  move, because playouts play other moves: the census above lists what
  moved.
- **The residual blindness.** The rank reads a move's kind, never what it
  does: among distinct candidates of one kind on a priority or a choice ply
  (two activations, eleven graveyard targets) the first two enumerated are
  probed and the others only by the rollout's random branch; two copies of
  one play count as two. On an attack ply of three creatures or more the
  attacks by two, and every lone attack but the strongest, are left to the
  same random branch. The blade's
  stretch entry "rollout probe cut: holds Emperor of Bones' Adapt in main 1
  with two identical pump activations enumerated before it" reads it on a
  wide board: of 14 seeds, every candidate probed passes 12 and the shipped
  cut 2. The blade's boards are narrow (2.2 candidates per probing ply at
  the median, the note's § 3), so its census is a strong reading for narrow
  boards and a thin one for wide ones. A rank that reads what a move does at
  no cost per candidate is the open lever; the probe history above is not
  it.
- **Guarded by** `convex/gre/__tests__/rolloutProbeCut.bot.test.ts`: the
  kept decline, the kind rank, the widest declaration and the strongest lone
  attacker, each proven to fail without its mechanism, and the enumeration
  order between equal kinds pinned as it is. The Bot-play sweep's pump and
  grant fixtures (`botReachPlayPump.bot.test.ts`,
  `botReachPlaySacrificeB.bot.test.ts`) read the attack ply end to end.
- **The field reading** (`probesPerIteration.p50`, `msPerProbe.p50` in the
  per-game `bot search` report, issue #10321) is issue #10612, after a
  release.
