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
  and the game-end Verdict judge search a fresh tree at fixed iterations: no
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
  decides, on the same keeper and the same walk: Amendment I below.

## Alternatives considered

- **Count iterations run, not root visits.** Reuse would then only add visits
  on top of a full budget, costing the same wall clock for a stronger answer;
  it would not move the field toward the ruling's 400, which is what the
  owner asked of it.
- **Drop on a turn boundary or on the bench's `botDrew` proxy.** Both are
  wrong in each direction: the observation is the event, not the turn, and a
  bounce changes the hand while revealing nothing (note § 3).

## Amendment I — pondering (2026-11-23, issue #10472)

The owner ruled on 2026-11-22 (research note § 6) to build pondering, and to
run it **on phones too** ("nessuno giocherà a Tolaria sul telefono per ore"),
overruling the note's proposal (§ 4) to keep it off where `device.mobile` is
true.

1. **The Worker grows the kept tree while the human decides.** At each human
   decision the page opens (`consult-path.ts`'s `onHumanWindow`), it reads the
   Bot's own projection of that position once and posts a `ponder`: that
   state and the decisions since the last consult (`useBrainPonder`,
   `brain-client.ts`'s `ponderBrain`). The Worker walks the kept tree to the
   human's decision and makes it the kept tree's root, remembering the path
   to it as a `prefix`; anything the walk would drop for a consult, or a node
   some world handed to the Bot, ponders a fresh tree there instead
   (`convex/gre/ai/ponder.ts`). The search is the consult's own `iterate`,
   rooted at an opponent's node (`createPonderSearch`), from the Bot's point
   of view, with the last consult's seat and knowledge.
2. **The consult continues past the prefix.** Its steps (every decision since
   the last consult) must start with the ponder's prefix; the rest is walked
   from the pondered root to the subtree under the move the human actually
   played, exactly as decision 1 walks. A path that does not start with the
   prefix drops the tree (`mismatch`). Hidden information is decision 2's.
3. **Time slices.** Pondering runs a slice of iterations (`PONDER_SLICE_MS`,
   50 ms), then yields to the event loop. Every message the page posts but a
   Manifest prime ends the ponder before it is handled, so a consult waits at
   most for the slice under way when it arrived — inside the overrun margin
   the consult timeout is sized with (issue #10115, issue #10408).
4. **The stops.** A consult (any message); `visibilitychange` → `hidden` (the
   page posts `ponder-stop`; nothing resumes until the next human window); a
   tree a consult took; and the **node cap** (`PONDER_NODE_CAP`, `brain-ponder.ts`):
   12,000 nodes on a desktop, 4,000 on a phone. Measured before it was chosen
   (27 blade `must` boards at 3,000 iterations, a gc'd heap delta per grown
   tree): 0.07–1.3 nodes per iteration, 1.2–6 KB per node, the high end
   including caches a search holds besides the tree — about 72 MB at the
   desktop cap at worst, about 15 MB typical; about 24 MB on a phone at worst.
5. **The decision says what pondering gave it.** `DecisionTrace.ponder`:
   the iterations pondered since the last consult, the root visits of this
   decision they grew (part of `iterationsKept`), and the pondering time. The
   `bot.consult` span carries `ponder.iterations`, `ponder.kept`, `ponderMs`;
   the game's report `ponder.iterations`, `ponder.kept`, `ponderMs.p50` —
   behind their allowlists, under the owner's standing consent of 2026-11-22.
   Their `device.mobile` split is how the phone ruling gets checked.

**Consequences.** A live decision now also depends on **how long the human
took**: the same board after the same moves can yield a different move
depending on how many iterations the Worker pondered. A field decision whose
trace shows `ponder.kept > 0` does not replay from its board. Tests and the
blade are untouched — every test search is fresh at fixed iterations, and a
test ponder runs a fixed number of iterations, never wall-clock. The new
guard is a blade sequence entry that ponders the human's real choice between
two Bot decisions and asserts the Bot's answer on the pondered tree, on the
kept tree without pondering and on a fresh one. CPU and battery: the Worker
searches through most of the human's thinking time instead of about 14% of a
game (note § 4); no phone has been measured.
