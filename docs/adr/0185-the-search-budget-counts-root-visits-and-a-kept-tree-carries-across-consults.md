# The search budget counts root visits, and a kept tree carries across consults

Date: 2026-11-22

## Status

Accepted (2026-11-22, owner ruling in an attended session, issue #10470,
`docs/research/brain-pondering-tree-reuse.md` § 6). Amends ADR 0000 § 7
("Difficulty = search budget"). ADR 0000 § 1 (one information-set tree,
re-determinized per iteration) stands as written: reuse keeps one tree.

## Context

The owner ruled that `expert` must reach 400 iterations per search on every
engine family (issue #10027). The field Bot completes far fewer in WebKit and
Gecko, and every consult started from an empty tree. When the Bot decides
again straight after its own move, the subtree under the move it played holds
a median 53% of the root's visits (99 decisions; 54% over the 89 walks where
the Bot did not draw). That is search already paid for and thrown away
(research note § 2, measured at `edd20dd4c`).

ADR 0000 § 7 made difficulty a search budget, and the budget a count of
iterations run in one consult: a decision depended on its position, its seed
and, in live play, the clock.

## Decision

1. **The Brain Worker keeps the tree its last search grew** — its root, the
   Bot's projection it was grown from, the game, the seat and the Worker's
   catalogue (`TreeKeeper`, `convex/gre/ai/brainRequest.ts`; held by
   `src/lib/ai/brain.worker.ts`). The next consult names the decisions played
   since, the Bot's own move first, as the search's own tree keys read on each
   deciding seat's view (`treeKeyOf`; the client's `consult-path.ts` names the
   human's moves through the `human-move-match.ts` bridge). The Worker walks
   them and continues from the node reached (`convex/gre/ai/treeReuse.ts`).
2. **The tree is dropped** — today's behaviour exactly — on a change of game,
   seat or catalogue; on any step the client cannot name or the tree never
   took; and whenever the path crosses an observation the Bot makes: a card
   whose identity the Bot did not see at the old root and sees now, that
   neither a fresh object nor a card the opponent showed by its own move
   explains (its own draw, a reveal, a random discard). The tree has no chance
   nodes, so a kept node after such an event would fuse strategies across
   outcomes the Bot can tell apart.
3. **The budget counts root visits.** A kept subtree holding 200 visits needs
   200 more iterations to reach 400. The early-stop rule and the starved-root
   floor read root visits too. The time cap is unchanged: it bounds one
   consult's wall clock, whatever was kept.
4. **A kept node becomes a root** (`adoptKeptRoot`, `convex/gre/search.ts`):
   the root-only rules (dominance pruning, the repetition deny-set, the
   collapse of interchangeable copies) remove their denied edges with their
   statistics; the caches decided below the root are cleared and the moves
   the below-root filters dropped are unopened edges again. A node any world
   handed to the other seat, or holding an edge that is no move of the Bot
   here, is not this decision: fresh tree. Kept counts are not discounted.
5. **A decision says what it ran on.** The DecisionTrace records
   `iterationsKept`; the game's search report carries `iterations.kept` and
   the `bot.consult` span the same attribute (the owner's standing consent of
   2026-11-22 to telemetry keys of this kind).

## Consequences

- **A live decision depends on the game's history of consults**, not only on
  its position, seed and clock: the same board can yield a different move
  depending on what the Worker kept. A decision reported from the field no
  longer reproduces from its board alone when its trace shows
  `iterationsKept > 0`; one with `iterationsKept: 0` still does.
- **Tests and the blade are untouched.** Every test, every blade `must` entry
  and the server's game-end judge search a fresh tree at fixed iterations: no
  caller but the Worker holds a keeper, and a request without `reuse` keeps
  nothing. The new guard is the blade SEQUENCE entry
  (`convex/gre/ai/blade/sequences.ts`): two consecutive Bot decisions through
  the live request path, the second asserted on the kept tree and on a fresh
  one, including a drop on the Bot's own draw.
- **Accepted skews.** Leaf rewards are decayed from the old root's game clock
  (`winTimingDecay`); within a turn that is a few steps. Visits from worlds
  the new information rules out stay in the kept nodes until new iterations
  outweigh them. Both are stated in the research note § 3; no discount until
  a reading says what factor.
- **`iterations.ratio` keeps its meaning** — iterations run over iterations
  requested — so a consult that kept visits reads below 1 even when its root
  reached the budget: `(completed + kept) / requested` is the root's reading.
- **Slice 2, pondering** (issue #10472), grows the kept tree while the human
  decides, on the same keeper and the same walk.

## Alternatives considered

- **Count iterations run, not root visits.** Reuse would then only add visits
  on top of a full budget, costing the same wall clock for a stronger answer;
  it would not move the field toward the ruling's 400, which is what the
  owner asked of it.
- **Drop on a turn boundary or on the bench's `botDrew` proxy.** Both are
  wrong in each direction: the observation is the event, not the turn, and a
  bounce changes the hand while revealing nothing (note § 3).
