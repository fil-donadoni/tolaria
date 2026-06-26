# 1. AI opponent: client-side ISMCTS over the real GRE, server-authoritative apply

Date: 2026-06-13

## Status

Accepted

## Context

We want a single-player "vs-AI" game mode. The opponent must play a real game
of Magic, not just make legal moves. Several axes had to be decided together
because they constrain each other.

Surveyed prior art:

- **Heuristic / rule-based** (Forge `PlayerControllerAi`, XMage): a tree of
  `if`s plus per-effect evaluation. Ships fast, runs inline, but plays weakly —
  especially combat, sequencing, and timing. Lots of hardcoded per-card logic.
- **MCTS + determinization** (Cowling/Powley/Ward, _Ensemble Determinization
  in MCTS for Magic: The Gathering_, 2012): actually searches. Handles the
  imperfect-information nature of the game (hidden hand + library order) by
  sampling possible worlds. Costs thousands of state clones + rollouts per
  decision.
- **Neural net / RL** (AlphaZero-style, peter1591/hearthstone-ai, LearnForge):
  strongest in theory, but needs a training pipeline, dataset and GPUs. Out of
  scale for a study engine. For MTG, published work is on _drafting_, not
  full-game play.

Key local facts that shaped the decision:

- The GRE in `convex/gre/` is **already pure and isomorphic**: no
  `convex/server`, `convex/values`, `_generated`, or `ctx.*` imports; all
  imports are relative. It can run client-side as-is.
- `getLegalActions` / `getLegalTargets` exist but are **per-card and
  UI-oriented**. There is no full per-player move generator (combat
  declaration combinations, target/mana/mode expansion).
- `CardInstanceState` is fat (~50 fields + the embedded `card` definition +
  UI-only fields like `animation`, `bgColor`). Cloning it naively per search
  step is the perf bottleneck.
- A **solo game** already exists (`createSoloGame`): one user controls both
  seats (`${userId}-p1` / `-p2`), and one mutation accepts moves for both.

The hard constraint: a Convex **mutation** has a limited execution budget and
must stay fast/transactional — it cannot host 10k+ simulations. MCTS needs a
runtime that can spend ~1s of CPU per decision.

## Decision

Build the AI opponent as **ISMCTS (Information-Set Monte Carlo Tree Search)**
that runs **client-side in a Web Worker**, reusing the **real GRE** for
simulation, while **the server stays authoritative** for applying moves.

Concretely:

1. **Algorithm: ISMCTS.** A single information-set tree, re-determinizing the
   hidden information (opponent hand + library order) once per iteration. On a
   single-threaded, budget-limited client this concentrates the scarce
   iteration budget in one tree, and handles hidden info more soundly than a
   PIMC ensemble (which would divide the budget across N trees and suffer
   strategy fusion).
2. **Truncated rollouts + heuristic evaluation.** Rollouts stop at depth K and
   estimate the winner with a hand-written eval function, instead of playing to
   a terminal state. Full-to-terminal rollouts are too slow on a mid-range
   phone (~50–300/s vs ~1k–5k/s truncated). The eval doubles as an instant
   fallback when there is no CPU budget.
3. **Atomic macro-moves.** Each tree edge is a fully-specified move
   (card + targets + mana + mode), not the existing multi-step interactive
   sequence (`cast` → `selectTarget` → pay mana). Keeps the tree shallow and
   rollouts short. Requires a new `enumerateMoves(state, player) → Move[]`
   generator, including combat-declaration combinations.
4. **Reuse the real GRE; no second simulator.** Search applies macro-moves
   through the existing pure GRE functions — one source of rules truth, every
   card implemented once. Perf is recovered via **structural sharing** (copy
   only touched paths, share read-only fields like `card`/`animation` by
   reference), not by maintaining a parallel approximate engine.
5. **Server-authoritative apply via the solo-game path.** A vs-AI game is
   structurally a solo game where one seat's moves are chosen by the bot. The
   client computes the bot's move with ISMCTS, then submits it through the same
   validated mutation a human move uses. The client-side GRE is a _thinking
   sandbox only_ — it never has authority.
6. **Cheap gate + reuse auto-pass.** A fast static filter decides whether a
   priority window is "interesting" (own main phase, combat, relevant non-pass
   moves, useful instants). ISMCTS runs only there; otherwise the bot
   auto-passes immediately using the existing auto-pass mechanism.
7. **Difficulty = search budget.** `search(state, budget)` is parametric from
   day one; difficulty presets scale iterations/time. One engine, one knob.

## Consequences

- **The documented boundary "frontend never imports `convex/gre/`" is
  relaxed**, deliberately and narrowly: the GRE must be extracted into a shared
  package importable by both Convex and the client. Multiplayer keeps using the
  server GRE; the client GRE is used only as the bot's brain in vs-AI games.
- **No extra Convex cost vs a human game.** Moves are one mutation each
  regardless of who decides them; ISMCTS compute is on the client; no server
  action is involved. The only delta is a marginally larger query payload — the
  client receives the bot's unredacted hand to plan with (same call, more
  bytes). This zero-extra-cost property holds _only while the brain stays
  client-side_; moving it to a Convex action to hide the bot's hand would add
  server compute.
- **The bot's hand is visible to the human's client process** (readable via
  devtools). Accepted: vs-AI is single-player, so this is self-cheating only.
- **New work required:** the `enumerateMoves` generator (the largest new
  piece), the truncated-rollout eval function, structural-sharing perf work on
  the GRE state, and the Web Worker harness.
- **Upgrade path preserved.** A value/policy neural net can later replace the
  rollout/eval or guide selection without changing the surrounding design.

## Alternatives considered

- **Heuristic-only (Forge-style).** Ships fastest, runs inline, no boundary
  break. Rejected as the _target_: plays weakly, and the user explicitly
  prefers MCTS strength. The eval function we still write is the Forge-style
  heuristic, reused at rollout leaves.
- **PIMC ensemble** instead of ISMCTS. Simpler, validated on MTG by Cowling.
  Rejected for v1: on a single thread it divides the scarce budget across N
  independent trees and plays "omnisciently" (strategy fusion).
- **Dedicated fast simulator** with approximate rules. More iterations/s, but
  two rule engines that diverge — a bug farm that contradicts the project's
  rules-correctness goal and doubles the cost of every new card.
- **Brain in a Convex action** (server-side search). No bot-hand leak, no phone
  CPU cost, but adds per-move server compute and abandons the client-MCTS
  approach. Kept as a fallback if the hand leak ever becomes unacceptable.
- **Fully client-authoritative AI game.** No server round-trip per move, but
  forgeable if results feed shared/persistent data, and forces a duplicate
  client-side orchestration loop (priority, stack, scheduler). Rejected.
