# Pondering and tree reuse: the Brain thinks on time it already has (issue #10136)

> **Measured at** `edd20dd4c`, 2026-11-19, on the development MacBook (Apple
> M1 Pro, 8 cores) while it was also the pipeline's runner (load average up
> to 12). Every search here is iterations-only, so load moves the wall clock
> and nothing else. Field figures: the 28 `bot search` reports in Sentry over
> the 14 days to 2026-11-19, which all fall between 2026-11-15 09:10 and
> 2026-11-16 16:38 Rome time. **Dated:** every number below is as of that
> commit and those reports. Slice of PRD issue #10017. The owner's ruling
> goes in § 6.

**Question.** The owner ruled (issue #10027, `expert-think-longer.md` § 5) that
`expert` must reach 400 iterations per search on every engine family. The
field Bot completes 313 per search in Chromium, 200 in WebKit and 71 in Gecko
(`blade-at-field-budgets.md`). Every consult starts a fresh tree, and the
Worker sits idle whenever the human holds priority. How much time is there,
and how much of a grown tree is still worth something at the Bot's next
decision?

**Verdict up front.**

1. **The Worker is idle about 86% of a game.** Between two Bot consults it
   waits a median of **22 s** (8 segments of 6 games, from 10 to 32 s), and
   the Bot's own searching takes a median of **14%** of the segment's
   wall-clock time. These are upper bounds on idle time (§ 1).
2. **A kept tree keeps about half the search when the Bot moves again.** When
   the Bot decides again straight after its own move, the subtree under the
   move it played holds a median **53%** of the root's visits (99 decisions).
3. **A human reply with a real choice cuts that to about a third.** When the
   opponent really chooses in between, the Bot's next decision keeps a median
   **13%** of the root's visits: **32–36%** of the subtree under the Bot's move,
   depending on which reply is played (31 decisions, a thin sample). A forced
   reply (one option) keeps nearly all of it.
4. **Arithmetic for the ruling.** If a pondered tree keeps about a third, 22 s
   of pondering is worth about 700 iterations in Chromium, 440 in WebKit and
   160 in Gecko. Added to the consult's own iterations that is about 1000, 640
   and 230. **Chromium and WebKit reach 400 with pondering alone. Gecko does
   not**, but gets about three times its 71.
5. **The hidden information is sound with one exception.** A subtree under the
   human's actual move only received visits from worlds where that move was
   legal. The exception is a reveal the Bot observes (its own draw, a reveal
   from a library): there the kept node mixes worlds the Bot can now tell
   apart, so the tree is dropped (§ 3).
6. **Proposal** (§ 5): first tree reuse across the Bot's own consecutive
   consults, then pondering. Pondering runs in time slices and stops on a
   consult, on a hidden page and on a memory cap. Kept visits count toward the
   400-iteration target. This amends ADR 0000 § 7. **The owner rules it in
   § 6 before any implementation slice is filed.**

## 1. How much time there is

The `bot search` report (`src/lib/ai/bot-search-telemetry.ts`) has no
think-time key and no idle-time key, and `REPORT_KEYS` does not grow without
the owner's consent (PRD issue #10017). But before issue #10022 a game could
send several reports: one per driver mount, plus one when the page was hidden.
The gap between two reports of the same game is the wall-clock time the second
report covers, and its consults say how much of that time the Worker spent
searching.

```text
busy ≈ consults × consultMs.p50
idle per consult = (gap − busy) / consults
```

| Game (prefix) | Engine   | Gap (s) | Consults | Busy share | Idle per consult (s) |
| ------------- | -------- | ------: | -------: | ---------: | -------------------: |
| `jh74q517`    | WebKit   |     493 |       27 |        18% |                 14.9 |
| `jh7bkzta`    | WebKit   |     203 |        6 |        10% |                 30.5 |
| `jn77da2w`    | Chromium |     490 |       14 |       9.5% |                 31.7 |
| `jh74dkfv`    | Gecko    |    2589 |       85 |        11% |                 27.1 |
| `jh74dkfv`    | Gecko    |     105 |        4 |        14% |                 22.6 |
| `jh7334vv`    | Chromium |     271 |       13 |        16% |                 17.5 |
| `jh7267tb`    | Chromium |     159 |       13 |        19% |                  9.9 |
| `jh7267tb`    | Chromium |     322 |       13 |        14% |                 21.4 |

Medians: **busy 14%, idle per consult 22 s.** How to read them:

- **The gap is an upper bound on time spent playing.** A report flushed on a
  hidden page starts a gap that includes however long the page stayed hidden.
  So the busy share is a lower bound, and the idle time is an upper bound. The
  43-minute Gecko gap is the likeliest case of this.
- **`consults × p50` is approximate.** A consult with no search (a forced
  move) ends fast, so this overstates busy time a little. That error runs the
  other way from the first.
- **Idle per consult is not the human's think time per decision.** It also
  covers server round trips, animations, and Bot priority windows the cheap
  gate passes without a consult (ADR 0000 § 6). For pondering it is the right
  number all the same: it is the time the Worker could have spent searching.
- Eight segments from six games, all on the owner's desktops. No phone report
  exists (`brain-search-in-the-field.md` § 4).

**Measurement plan, for the owner to rule on.** Since issue #10022 a game
sends one report, and the method above no longer works. A clean reading needs
one new coarse key, **`idleMs.p50`**: the time from a consult's answer to the
next consult's post, per game. It is a duration like the keys already sent,
and it carries nothing about the player, the cards or the board. Without that
key, the alternative is a solo game timed by hand on each engine.

## 2. What a kept tree is worth

**Method.** `scripts/brain-bench/entry-reuse.mjs` is bundled with the
root-capture seam the root-parallel bench added (`bundle.mjs`, issue #10135).
That seam is applied at bundle time and searches byte-identically when no hook
is installed. Each of the 614 blade `must` entries is run at its first
declared seed. The Bot's search runs at 400 iterations (the ruling's target)
and its grown root is captured. Then the real position is walked forward
through the tree, using the search's own transition (`applyMoveInSearch`) and
its own keying (`keyedMovesFor`): first the Bot's chosen move, then the
opponent's moves, until the Bot decides again. At each step the visits under
the move played are read. On an opponent node that is the sum over its
option-set views (issue #8939). The opponent's reply is played three ways:

- `search`: a 400-iteration search for the opponent's seat on the real
  position. This is a competent reply that the Bot's tree did not choose.
- `tree`: the reply the Bot's tree visited most. This is the tree's own
  guess, so it gives the most favourable reading.
- `pass`: `pass` wherever it is legal, otherwise the `search` reply. Passing
  is the commonest human action.

Of the 614 entries, 567 search (the rest are forced). 549 walks reach a Bot
decision again, and 18 end the game first. Shares are against the search's
completed iterations: 188 searches stopped early as settled, at 214
iterations at the lowest.

**Case A: the Bot decides again straight after its own move.** For example,
a cast after which the caster holds priority again. 99 decisions.

| Share of the root's visits kept | mean | p25 | p50 | p75 |
| ------------------------------- | ---: | --: | --: | --: |
| 400 iterations                  |  51% | 42% | 53% | 59% |
| 100 iterations                  |  48% | 37% | 50% | 55% |

**Case B: the opponent replies, then the Bot decides.** 450 decisions. In
419 of them the opponent's only option was one move. A blade board is built
around the Bot's decision, and the opponent usually holds nothing. Those 419
keep almost everything under the Bot's move (all 450: median 53% under the
Bot's move, 52% kept). The 31 where the opponent really chose are the reading
that matters:

| Opponent had a real choice (31) | Kept, share of root (p50 / mean) | Kept, share of the subtree under the Bot's move (p50 / mean) |
| ------------------------------- | -------------------------------: | -----------------------------------------------------------: |
| `search` reply                  |                        13% / 12% |                                                    35% / 30% |
| `tree` reply                    |                        14% / 17% |                                                    36% / 44% |
| `pass` reply                    |                        13% / 16% |                                                    32% / 38% |

At 100 iterations the same rows read 12/11, 13/16 and 11/14 (share of the
root, p50/mean). The shares barely depend on the budget, so they carry over
to the field's 71–313. In two of the 450 walks the `search` reply left the
tree entirely: that reply was never visited.

Two limits of the split. "Real choice" counts the options on the real
board, not in the tree's worlds: a reply forced on the real board can still
lose visits to a trick the sampled worlds held, but only 3 of the 419 forced
walks keep less than 90% of the subtree. And at an opponent node the bench
also adds any Bot edge stored under the same key, so a node decided by
different seats in different worlds counts a shared `pass` twice. That case
is rare, and its effect on the medians is negligible.

**Reading.** The Bot's own next decision gets about half of the last search
for free. A human reply with a real choice gets about a third of the subtree
it lands in: a third of the iterations spent pondering a human decision
survive into the Bot's answer. The sample of real choices is thin (31), and
a real main phase is wider than a blade board (75–90 candidates, against a
median of 2 root candidates here), so the field share under a human's move is likely lower.
Recorded games would measure it. The owner's games are not stored with their
moves (no event log), so that measurement needs the per-game move capture
`human-decision-capture.ts` already keeps for Verdict Proposals.

## 3. Hidden information

The tree is one SO-ISMCTS tree grown over worlds determinized from the Bot's
information set at the old root (ADR 0000 § 1). What happens to a kept
subtree once new cards are seen:

- **The human's move reveals a card (a cast, a land, an activation from
  hand).** This is sound by construction. The opponent's move key folds a
  hand card to its definition id (`priorityMoveKey`), and an edge collects
  visits only in worlds where that move was legal. So every visit under the
  move the human actually played came from a world where they held that card.
  The world mix under that subtree is weighted by how often the tree's
  opponent policy chose the move in each option-set view. That is a
  likelihood update with the tree's opponent model as the likelihood. It leans
  towards the worlds the tree explored most, which is a bias but not an
  unsound one. This holds for an informed seat only: with blind placeholders
  for the opponent's hidden zones the fold is inert (`priorityMoveKey`'s own
  comment), so a human's cast from hand is on the tree only when the
  opponent's deck knowledge is supplied. `expert`, the only level played
  today (issue #10113), supplies it.
- **New information the Bot observes from a chance event (its own draw, a
  reveal, a shuffle seen through, a random discard).** This is unsound. The
  tree has no chance nodes: a node after the Bot's draw pools every world's
  draw, and the Bot now knows which card it drew. Kept, the node's statistics
  fuse strategies across draws the Bot can tell apart. That is the same
  strategy fusion the option-set views (issue #8939) remove at the opponent's
  nodes. The rule: **drop the kept tree when the path from the old root to the
  new one crosses an observation the Bot makes.** The check is on the
  observation, never on the turn: in the measurement all 22 of the 450 case B
  walks where the Bot drew stayed inside one turn (an upkeep into the draw
  step, a draw ability resolving), and only 2 crossed a turn at all. The
  bench's `botDrew` flag (a new card id in the Bot's hand) is a rough proxy:
  it also counts a bounce, which reveals nothing, and misses a reveal that
  leaves the hand unchanged. Slice 1 needs the real predicate: an event that
  moves a card out of a zone hidden from the Bot.
- **Worlds the new information rules out (a card now visibly elsewhere).**
  Their visits stay in the kept nodes. New iterations sample only consistent
  worlds and outweigh them as the search runs. A discount (scaling a kept
  node's counts by a factor below 1) would speed that up, but no number here
  says what factor. Proposed: no discount in the first slice, and a blade
  sequence entry that would show the need for one.
- **Root-only rules.** Dominance pruning, the repetition deny-set and the
  collapse of interchangeable copies run once, at a Bot root
  (`runSearchWithTrace`). A kept subtree never had them applied as a root.
  When it becomes the root, the denied edges must be removed together with
  their statistics, not just skipped, because `selectRootMove` reads the
  root's child edges.
- **Below-root pruning, the other direction.** A node below the root was
  pruned by rules the root deliberately does not apply. `iterate` filters
  deferrable sacrifices and the sacrifice-conversion shapes, and decides
  `opposingGateArmKeys`, only at `depth > 0`, because a sacrifice the Bot
  could take now must stay a scored option at the root.
  `dominatedTargetKeys` is decided with `belowRoot` set, which adds the beam
  pruning `beamTriggerTargetsByValue`. It is also not purely public-board,
  because a resolution reading a sampled hidden zone can judge differently.
  When a kept node becomes the root, those caches are cleared, and moves the
  below-root filters dropped are re-admitted as unopened edges.
  `dominatedBlockKeys` (public board, same rule at every depth) and
  `policyValues` (already shared across worlds) can stay.
- **Reward clock.** Leaf rewards are decayed by time since the root's game
  clock (`winTimingDecay`, `since = gameClockOf(rootState)`). A kept subtree's
  rewards were measured from the old root's clock. Within one turn the
  difference is a few steps. The first slice should accept that skew and say
  so.

## 4. Cost and resilience

- **CPU and battery.** Pondering turns a Worker that is busy about 14% of a
  game into one that is busy nearly 100% of it, so about 6× the Brain's CPU
  time per game, on one core. That is invisible on a desktop. On a phone it is
  a battery cost the player did not choose, and no phone has been measured
  yet (issue #10116 owns the weak-client reading). Proposed: pondering off
  when `device.mobile` is true until a phone reading exists.
- **A backgrounded tab.** Searching for a player who cannot see the game is
  waste. Pondering stops on `visibilitychange` → `hidden`, the same event the
  report already flushes on, and does not resume until the next consult. How
  each engine throttles a dedicated Worker in a hidden page was not measured
  here. Stopping on the event makes the answer not matter.
- **A Worker busy pondering when the real consult arrives.** Today's Worker
  serves one request at a time and never cancels (`brain.worker.ts`): a
  synchronous search loop cannot read its inbox. So pondering **runs in time
  slices**: a slice of iterations (about 50 ms), then a yield to the event
  loop, where a waiting consult ends pondering. The longest a consult waits is
  one slice, inside the overrun margin issue #10115 sizes. A consult never
  queues behind a whole ponder.
- **Memory.** A pondered tree grows for as long as the human thinks, 2000
  iterations or more in Chromium. Tree memory per iteration was not measured
  here (`memory.mjs` measures heap for one search). Pondering needs a node
  cap, measured before the slice ships.
- **A wrong guess costs nothing but the idle time.** When the consult's
  position is not on the kept tree (an unmatched move, an observation crossed,
  a remount), the consult starts a fresh tree, exactly as today.

## 5. Proposal

**Slice 1: tree reuse across the Bot's own consults (no pondering).**

- The Worker keeps the last search's root, its root state and the move it
  returned. The next consult carries the moves played since: the Bot's own
  move, plus the human's moves in the Brain's vocabulary (the
  `human-move-match.ts` bridge the Verdict Proposal capture already uses).
  The Worker walks them through the tree (`keyedMovesFor`, as § 2 does) and
  continues from the node reached, or from a fresh root on any mismatch, any
  observation crossed (§ 3) or any change of game, seat or catalogue.
- **The budget counts root visits, not iterations run in this consult.** A
  kept subtree holding 200 visits needs 200 more iterations to reach 400. The
  time cap is unchanged. This is what turns reuse into the ruling's currency:
  case A alone moves Gecko's 71 to about 106 per decision and Chromium's 313
  past 400 on 91 of the 99 consecutive decisions measured (a kept share of
  28% or more). Those 99 include 10 walks where the Bot drew, which § 3 says
  to drop. Without them: 89 walks, median kept share 54%, 83 at 28% or more.
- The root-only rules are re-applied at the new root, removing the denied
  edges with their statistics (§ 3).
- The blade is unchanged. A `must` entry searches a fresh tree at its
  declared iterations, so the blade still proves the decision function, and
  reuse can only add visits on top of it. A blade _sequence_ entry (two
  consecutive Bot decisions, asserting the second decision with and without a
  kept tree) is the new guard.
- Telemetry: the existing `iterations.completed` reads the visits searched;
  the kept visits need a coarse key (`iterations.kept`), and that needs the
  owner's consent (PRD issue #10017).

**Slice 2: pondering.** Pondering means growing the tree while the human
decides. It needs a search entry rooted at the human's decision.
`runSearchWithTrace` returns at once when the deciding player is not the
seat it searches for, so what pondering lacks is a tree grown from the Bot's
point of view and rooted at a human decision. `iterate` already handles an
opponent's node at any depth. Pondering runs in
time slices (§ 4), from the position the Bot just left the human. It stops on
a consult, on `visibilitychange` → `hidden`, on the node cap, and when
`device.mobile` is true. The consult then continues from the subtree under
the human's actual move, as in slice 1. The Brain channel gains a
cancellable "ponder" message whose state is the human's decision point. The
consult itself is unchanged apart from the moves-since list.

**ADR.** Both slices amend **ADR 0000 § 7** ("Difficulty = search budget"):
the budget becomes root visits, and a decision depends on the history of the
game's consults, not only on its position. Today a decision depends on the
position, the seed and the clock. Determinism in tests is untouched, because
the blade and every test search a fresh tree at fixed iterations. A live
decision already depends on the clock today, and now also depends on what
the Worker kept. A new ADR records the amendment. ADR 0000 § 1 (one
information-set tree, re-determinized per iteration) stands as written:
reuse keeps one tree.

## 6. The owner's ruling

**Pending.** This note was written in an unattended pass. The questions the
owner rules on:

1. Build slice 1 (tree reuse, budget counted in root visits)?
2. Build slice 2 (pondering), and with `device.mobile` off by default?
3. Consent to the two coarse report keys: `idleMs.p50` (§ 1) and
   `iterations.kept` (§ 5)?
4. Accept the amendment of ADR 0000 § 7 as a new ADR?

The implementation slices are filed under PRD issue #10017 once the ruling is
recorded here.

## Not measured

- The human's think time per decision. The idle time in § 1 is an upper
  bound read from report gaps, and the clean reading needs `idleMs.p50`.
- Reuse share on recorded games and on wide boards. The blade sample of real
  human choices is 31 decisions on narrow boards.
- What a kept visit is worth against a fresh one. A kept subtree's
  statistics were grown under the old root's world distribution and clock.
  The blade sequence entry of slice 1 is the first reading.
- Tree memory per iteration, phone CPU and battery, and throttling of a
  Worker in a hidden page (§ 4).

## Reproduce

Field (§ 1): Sentry log explorer, org `filippo-donadoni`, 14 days,
`message:"bot search"`, fields `timestamp`, `gameId`,
`tags[consults,number]`, `tags[consultMs.p50,number]`, `device.engine`.
Games with more than one report give the segments.

Tree reuse (§ 2):

```bash
B=<scratch>/reuse.js
node docs/research/scripts/brain-bench/run-reuse.mjs build "$B"
for i in 1 2 3 4; do
    node docs/research/scripts/brain-bench/run-reuse.mjs run "$B" r$i.jsonl \
        --iterations 400 --every 1 --slice $i/4 &
done; wait
node docs/research/scripts/brain-bench/run-reuse.mjs summarize r1.jsonl r2.jsonl r3.jsonl r4.jsonl
```

`--iterations 100` gives the second budget. Four slices take about three
minutes on the MacBook.
