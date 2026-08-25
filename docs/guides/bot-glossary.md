# Bot glossary — the play-Bot's jargon, for readers who have never built one

**Read this when a bot document uses a word you cannot place** — `FPU`,
`prior`, `leaf`, `rung`, `verdict`. Each entry says what the thing IS, in plain
words, and then where it lives in this repo. It is a lookup table, not a
tutorial: read the entry you need and go back to the document you came from.
The domain terms that are part of the project's shared language (Brain, Blade
Scenario, Ladder, …) also appear in `CONTEXT.md`; this file is the wider
working vocabulary around them, including textbook search terms that
`CONTEXT.md` deliberately leaves out.

Every entry has an anchor (`bot-glossary.md#the-term`) so other documents can
link a word straight to its meaning.

---

## How the Bot decides — the pipeline

<a id="brain"></a>**Brain** — the component that computes the Bot's next move.
It only _proposes_; the engine (GRE) validates and applies, exactly as it does
for a human's click. Runs in the browser, in a Worker, never on the server
(ADR 0074). Code: `src/lib/ai/brain.ts`, `src/lib/ai/brain.worker.ts`.

<a id="move"></a>**Move** — one legal thing the Bot can do right now: play a
land, cast a spell with given targets, activate an ability, declare these
attackers, pass. The Brain chooses among Moves; it never invents one. Code:
`convex/gre/moves.ts` (`enumerateMoves`, the `Move` union).

<a id="enumerator"></a>**Enumerator** — the function that lists every legal
Move in a position. If a Move is not enumerated the Bot can never take it,
however good it is; "the bot never uses X" is usually an enumerator gap, not
a search gap. Code: `enumerateMoves` in `convex/gre/moves.ts`.

<a id="executor"></a>**Executor** — turns the chosen Move into the same
sequence of server mutations a human's clicks would produce. Code:
`src/lib/ai/executor.ts`.

<a id="shouldthink-gate"></a>**shouldThink gate** — a cheap yes/no check run
before any search: is this the Bot's decision at all, and is there anything
but `pass` to choose? When the answer is no the Bot moves instantly. Code:
`convex/gre/shouldThink.ts`.

<a id="search-budget"></a>**Search budget** — how much thinking one decision
may cost, expressed as a number of [iterations](#iteration) and/or a
wall-clock cap in milliseconds. Tests and the [ladder](#ladder) always fix
iterations, never time, so results are reproducible on any machine. Code:
`SearchBudget` in `convex/gre/search.ts`; presets in `convex/gre/difficulty.ts`.

<a id="difficulty"></a>**Difficulty** — a named [search budget](#search-budget)
(easy / medium / hard). A stronger Bot is the same Brain given more budget,
not different logic; there is no "weak bot" code path.

<a id="time-management"></a>**Time management / early stopping** — spending
less of the [budget](#search-budget) when the decision is already settled and
all of it when candidates are close. The settled case is detected in iteration
counts (one move's visits cannot be overtaken by any other with what remains),
so it stays deterministic; wall-clock is only the hard ceiling. Not yet built
in this repo — see the roadmap.

## The search

<a id="mcts"></a>**MCTS (Monte Carlo Tree Search)** — a way to pick a move
without knowing the game's theory: build a tree of "what if I do this, then
they do that", grow it where the results look promising, and at the end play
the move that was explored the most. Each growth step is an
[iteration](#iteration).

<a id="ismcts"></a>**ISMCTS (Information Set MCTS)** — MCTS for games with
hidden information (the opponent's hand, the library order). Every iteration
first guesses a concrete possible world (a [determinization](#determinization))
and searches that world; over many iterations the guesses average out. Code:
`convex/gre/search.ts`.

<a id="determinization"></a>**Determinization** — one concrete guess of the
hidden information (a shuffled library, a plausible opponent hand) so the
search can reason about a fully-known position. Re-drawn every iteration.
Code: `convex/gre/determinize.ts`.

<a id="iteration"></a>**Iteration** — one pass of the search: pick a path down
the tree ([selection](#selection)), add one new node ([expansion](#expansion)),
play the position out a little ([rollout](#rollout)), score where it ended
([leaf](#leaf) → [reward](#reward)), and write that score back up the path
([backpropagation](#backpropagation)). Budgets are counted in iterations;
production plays ~400 per decision.

<a id="node"></a>**Node / child / edge** — a node is a position in the tree; its
children are the positions reached by each legal [Move](#move); the edge
between them carries the statistics (visits, total reward) the search uses to
choose where to go next.

<a id="root"></a>**Root** — the tree's top node: the real, current position.
The **root move** is the move finally played; it is chosen from the root's
children by `selectRootMove`.

<a id="selection"></a>**Selection** — walking from the root down through
already-expanded nodes, at each step choosing a child by a rule that balances
"looks good so far" against "barely tried yet" (see [UCB1](#ucb1),
[PUCT](#puct)).

<a id="expansion"></a>**Expansion** — adding a not-yet-tried child to the tree.
This search opens exactly one new child per iteration (one per legal Move, on
first visit); nothing caps how many children a node may eventually have.

<a id="branching-factor"></a>**Branching factor** — how many legal Moves a
position has. An MTG main phase often has 75–90 (every castable card × every
target × every way to tap for it). With 400 iterations and 80 children, each
root child gets ~5 visits — the reason the search alone cannot separate close
candidates and why [priors](#prior) matter.

<a id="ply"></a>**Ply** — one decision by one player; two plies make a full
"my move, your move" exchange. Depth is counted in plies.

<a id="rollout"></a>**Rollout / playout** — after expansion, playing the
position forward with a cheap policy (here: pick the move whose immediate
evaluation is best, with a 25% chance of a random move instead) until the
[horizon](#horizon), to get a rough sense of where the line leads. A
**truncated** rollout stops early and evaluates the position instead of
playing to the end.

<a id="horizon"></a>**Horizon** — where a rollout stops. Here: the start of
the Bot's next turn (ADR 0015), capped at 6 turns. A payoff that only shows up
beyond the horizon is invisible to the search — one of the named causes of a
[beyond-budget](#beyond-budget) position.

<a id="leaf"></a>**Leaf** — the position at the end of an iteration, where the
rollout stopped. It is scored by the [evaluation](#evaluation); that score,
mapped to a [reward](#reward), is what flows back up the tree.

<a id="backpropagation"></a>**Backpropagation** — writing the leaf's reward
into every edge on the path back to the root, so visits and average reward
accumulate. Done adversarially: a reward good for the Bot is bad for the
opponent's edges.

<a id="ucb1"></a>**UCB1** — the classic selection rule: score each child as
_average reward so far + c × √(ln(parent visits) / child visits)_. The second
term is the "curiosity bonus": it shrinks as a child gets visited, so untried
children get a turn. The constant `c` (`UCB_C = 1.4`) sets how curious the
search is. This repo's main action space uses UCB1.

<a id="prior"></a>**Prior** — a guess, made before any search, of how
promising each child is — here a cheap one-ply evaluation (`policyValue`) or a
hand-written heuristic. A prior biases _which children get visited first_; it
never removes a child. A move with a low prior is visited late, not never.
Used today only on [choice nodes](#choice-node); the main action space has
none yet (the roadmap's "priors on the action space").

<a id="puct"></a>**PUCT** — UCB1 with [priors](#prior) folded into the
curiosity bonus: children with a higher prior get their turn sooner. The
selection rule AlphaZero-family engines use; at small budgets it is the
published highest-confidence lever for strength (research `#1894`).

<a id="fpu"></a>**FPU (First-Play Urgency)** — what value to assume for a child
that has never been visited. Plain UCB1 treats "never tried" as infinitely
urgent, so every child must be tried once before any gets a second visit —
ruinous with 80 children and 400 iterations. FPU instead gives an untried
child a provisional value (typically slightly below its parent's), so the
search can revisit a good child before it has touched every bad one.

<a id="beam"></a>**Beam / beam search** — keeping only the K best-looking
candidates at each level and discarding the rest outright. Cheap, but it
throws away lines whose payoff comes later than their cost — in MTG that is
every sacrifice-then-payoff, fetch-then-cast, and combo-piece-first line. The
soft alternative is a [prior](#prior): bias, don't delete.

<a id="top-k"></a>**Top-K** — capping a candidate set to its K best by
[prior](#prior) _before_ it enters the tree. Used on [choice nodes](#choice-node)
(`CHOICE_TOP_K = 8`), whose raw candidate sets (subsets of cards, orderings)
are combinatorial. A form of beam, accepted there because the generator that
produces the candidates is also the one that can prove what it dropped.

<a id="progressive-widening"></a>**Progressive widening** — letting a node open
more children only as its visit count grows. Measured in this repo as barely
firing at 400–1200 iterations (`#1259`); not used.

<a id="dominance-pruning"></a>**Dominance pruning** — removing a Move from the
root's candidates because it is _provably_ no better than passing: casting a
board wipe on an empty board, an edict with nothing to sacrifice. "Provably"
is the contract — a proof from the effect's own semantics, never a heuristic
guess. Code: `enumerateMoves(…, { pruneDominatedNoOps })` in
`convex/gre/moves.ts`; applied at the root only (per-node cost measured at
~43% of wall clock).

<a id="choice-node"></a>**Choice node** — a decision the rules ask for in the
middle of a move (pay the punisher cost or not, which card to fetch, which
mode) represented as a node in the tree, so the search reasons about it
instead of taking a default. Before choice nodes the playout simply stopped at
such a decision, which is why the Stifle + Dreadnought line was invisible.
Code: `convex/gre/ai/choiceCandidates.ts`, `choicePriors.ts`.

<a id="candidate-generator"></a>**Candidate generator** — the per-kind function
that lists the sensible answers to a [choice node](#choice-node) (and their
[priors](#prior)). A choice kind with no generator is not a decision the search
can see; the Bot either freezes or takes an arbitrary default.

## Scoring a position

<a id="evaluation"></a>**Evaluation (eval)** — the number that says how good a
position is for a player: a weighted sum of life, untapped mana, permanents,
[card value](#card-value) in hand, creature quality, the [danger
clock](#danger-clock), plus combat terms. Hand-tuned weights, "Forge scale"
(a vanilla 2/2 ≈ 170 points). Code: `convex/gre/evaluate.ts` (ADR 0018).

<a id="margin"></a>**Margin** — the Bot's evaluation minus the opponent's: the
signed number the search actually compares.

<a id="reward"></a>**Reward** — the margin squashed into 0…1 so the search can
average it: ~0 = lost, ~1 = won, the open middle linear in margin. The
**reward bands** reserve the top and bottom quarter for positions that are won
or lost outright, so a win dominates any material count. Code:
`rewardFromValue` in `convex/gre/search.ts`.

<a id="indifference-band"></a>**Indifference band** — the range of margin
inside which two root candidates count as tied (`OUTCOME_EPS` on the reward
scale). Measured at ~100 margin points (≈ 12.5 life, ≈ 0.6 of a vanilla 2/2):
99.5% of real decisions fall inside it, which is why most picks are made by a
[tie-break](#tie-break) rather than by the search (`#1893`). The roadmap's
reward [calibration](#calibration) attacks this directly.

<a id="tie-break"></a>**Tie-break (root tie-break)** — a hand-written rule
that picks among root candidates the search considers tied: prefer more
material, don't attack for no damage, hold the instant, play the free land…
Ten exist today (`selectRootMove`, `convex/gre/search.ts`). Each is a correct
local patch; together they are a hand-written policy, which is the pathology
the roadmap exists to retire.

<a id="calibration"></a>**Calibration (margin → win probability)** — fitting,
on real self-play outcomes, how often a given margin actually ends in a win,
and using that curve as the [reward](#reward) instead of a hand-picked
constant (`MATERIAL_FULL = 500`). Stockfish's WDL model is the pattern. Issue
`#1929`.

<a id="fitted-evaluation"></a>**Fitted evaluation** — learning the
[evaluation](#evaluation)'s weights from outcomes (a logistic/linear fit over
a fixed feature basis) instead of picking them by hand. Linear, tiny, runs in
the browser — a neural network is out of scope (ADR 0074 budget).

<a id="card-value"></a>**Card value** — one card's worth in evaluation units:
_latent_ while in hand/library (potential), _realized_ once on the
battlefield. Derived from the card's own Effect Script through the
[valuers](#valuer); an explicit `aiValue` override exists for cards the
heuristic misjudges. Code: `convex/gre/ai/cardValue.ts`.

<a id="valuer"></a>**Valuer (OP_VALUERS)** — a per-Op function that turns one
Effect Script verb (`dealDamage`, `draw`, `destroy`, …) into value points and
feature tags, so a card's script can be priced with zero per-card knowledge.
Mirrors the interpreter's Op table and is coverage-guarded against it. Code:
`convex/gre/ai/opValuers.ts`.

<a id="beneficence"></a>**Beneficence** — per Op, whether the effect is a
_gift_ to its target, an _attack_ on it, or neutral — so the search knows
that Wild Growth on the opponent's land is a gift and Lightning Bolt on their
creature is not. Fails open to neutral, which is how unmarked Ops produce
"gifts". Code: `convex/gre/ai/beneficence.ts`.

<a id="aieffects"></a>**`aiEffects` (shadow script)** — for cards implemented
with imperative `resolve()` rather than an Effect Script: a valuation-only
script, never executed, that the same [valuers](#valuer) walk so the card is
not priced at the blind floor. Guarded catalogue-wide.

<a id="feature-basis"></a>**Feature basis** — the fixed list of dimensions a
card's value is expressed in (damage, card advantage, life swing, removal,
ramp, evasion, tempo, disruption, recursion, tokens, pump, protection). What a
[fitted evaluation](#fitted-evaluation) would put weights on. Code:
`convex/gre/ai/featureBasis.ts`.

<a id="danger-clock"></a>**Danger clock** — each player's estimated turns to
death from the board as it stands; the evaluation rewards holding the faster
clock. The one term that looks past the [horizon](#horizon).

<a id="policy-value"></a>**Policy value** — the cheap one-ply score used inside
[rollouts](#rollout) to pick the next move, and the natural source of a
[prior](#prior) for the action space. Code: `policyValue` in
`convex/gre/search.ts`.

## Measuring the Bot

<a id="blade-scenario"></a>**Blade scenario** — a hand-curated position where
the right play is beyond opinion, because the wrong one loses something
_forced by the rules_ (a creature, the game). The correctness metric: every
blunder seen in play becomes one. Fixed iterations and seeds ⇒ the chosen
move is byte-identical on any machine. Code: `convex/gre/ai/blade/registry.ts`;
admission rules ADR 0070.

<a id="must-stretch"></a>**`must` / `stretch` tier** — a `must` blade entry
blocks the gate (`bun run test:blade`); a `stretch` entry is report-only, for
positions the Bot is not yet expected to solve. A stretch entry that starts
passing is promoted.

<a id="beyond-budget"></a>**Beyond budget** — a blade position the Bot solves
only with more search than a real game grants, recorded with _why_: too many
candidates at one decision, a payoff past the [horizon](#horizon), a
hidden-information coincidence, or a mis-valued subtree (`valuation`, for
which no budget passes — more search converges _away_). Each cause names a
missing piece of knowledge, not a shortage of compute.

<a id="discriminating-pair"></a>**Discriminating pair** — two blade entries
identical but for one card, asserting opposite verdicts ("casts Dreadnought
WITH an out" / "does NOT cast it without"). Only the pair proves the Bot reads
the consequence rather than always or never making the play.

<a id="positive-control"></a>**Positive / negative control** — a blade entry
that must trivially pass (plays its only land) or must still do the normal
thing after a pruning rule lands (still casts Damnation into a real board), so
a broken harness or an over-eager rule is caught.

<a id="ladder"></a>**Ladder** — the strength metric: paired bot-vs-bot games
where both seats play the same decks with the same shuffles and only the Brain
configuration differs by seat, then swapped. The decks cancel out; the
verdict is PAIRED — a McNemar-style interval over the two orientations of
each seed (issue #2779), not an independent-trials Wilson interval over raw
games — see [discordant pair](#discordant-pair). `bun run ladder`
(`scripts/ladder.ts`); output is an append-only JSONL that doubles as the
[calibration](#calibration) corpus.

<a id="discordant-pair"></a>**Discordant pair** — a ladder seed whose two
orientations agree on which AGENT won, not which deck: the candidate takes
both games (a sweep FOR) or drops both (a sweep AGAINST). Only discordant
pairs carry information about the candidate/control difference — a
**concordant** pair (1-1: the same deck wins regardless of who is driving it)
cancels identically under any true effect and is pure noise if folded into an
independent-trials estimate. The paired 95% interval is built from the
discordant count alone (`pairedAggregate`, `scripts/lib/ladder/verdict.ts`),
which is why it reads roughly 2x tighter than treating every game as an
independent trial, measured on the 2026-08-24 placebo corpus (issue #2779:
±2.00pp paired vs. ±3.76pp unpaired on the same 680 games). A seed whose
partner game is missing — a guard stop on one side, or a resumed/filtered run
that never played it — is an **excluded pair**: dropped from the paired
statistic and reported separately, never folded in as a half-pair.

<a id="control-candidate"></a>**Control / candidate** — the two Brain
configurations a ladder run compares: control = production defaults,
candidate = one named variant. A control-vs-control run is the **null run**
and measures the harness's noise floor (must straddle 50%).

<a id="search-variant"></a>**Search variant** — one named, knob-level change to
the search that the ladder can A/B (`SearchVariant`, registered in
`LADDER_VARIANTS`). A strength experiment = one knob + one engine consultation

- one registry entry. Code: `convex/gre/ai/searchVariant.ts`.

<a id="pairing-registry"></a>**Pairing registry** — the curated deck pairs the
ladder plays, each tagged with the gameplay **dynamics** it exercises
(direct-damage, go-wide, discard, combo, …) — the coverage ledger. A change
claims strength on the dynamics it touches; a missing dynamic is added as a
row with the change that needs it. Code: `scripts/lib/ladder/pairings.ts`.
`bun run ladder --pairings deckA:deckB,...`, `--dynamics tag,...`, or
`--rung R0,R1,...` restricts a run to the matching subset of rows WITHOUT
renumbering them — seeds and `gameIndex` are always derived from a row's
index in the FULL registry (`scripts/lib/ladder/filter.ts`), so a filtered
run's records are exactly the matching subset of an unfiltered run's; the
header records the filter and `--resume` validates it (issue #2681). The three
flags are mutually exclusive — any 2-or-3-way combination fails
(`scripts/ladder.ts`).

<a id="rung"></a>**Environment rung** — a tier of the pairing registry ordered
by how much interaction the decks carry: R0 combat and racing (6 pairings),
R1 instant-speed interaction and repeatable abilities (8 pairings), R2 cube
archetypes with combos (3 pairings) — 17 rows total, all shipped (issue
#2689). Work climbs the rungs in order.

<a id="smoke-decision"></a>**`smoke` / `decision` tier** — ladder sizes: smoke =
4 seeds per pairing (48 games, direction only), decision = 20 seeds (240
games, the verdict a PR may quote).

<a id="verdict"></a>**Verdict (IMPROVEMENT / REGRESSION / INCONCLUSIVE)** — the
ladder's mechanical conclusion from a 95% Wilson confidence interval on the
candidate's win rate: entirely above 50% (and no matchup entirely below) →
IMPROVEMENT; entirely below → REGRESSION; straddling → INCONCLUSIVE. Pasted
in the PR as the durable record. Code: `scripts/lib/ladder/verdict.ts`.

<a id="wilson"></a>**Wilson interval** — the confidence interval used for the
verdict; behaves sensibly at small sample sizes, unlike the naive ±1.96σ.

<a id="seed"></a>**Seed** — the number that fixes every random draw (shuffles,
determinizations, rollout randomness). Same seed ⇒ same game ⇒ reproducible
bug and reproducible test. Every random draw in the Bot goes through the
seeded stream (`makeRng`).

<a id="self-play"></a>**Self-play** — the Bot playing both seats. Useful for a
distribution (strength, calibration corpus), useless for explaining one bad
pick — a decision is debugged with one blade scenario plus one unit test, never
a 200-game run.

<a id="decision-telemetry"></a>**Decision telemetry** — off-by-default
instrumentation recording, for every root pick, how it was decided (by the
search's mean reward, by the material tie-break, by a named rule) and by how
much. Code: `convex/gre/ai/decisionTelemetry.ts`; findings
`docs/research/decision-telemetry.md`.

<a id="decision-corpus"></a>**Decision corpus** — a reproducible batch of real
decisions (self-play games + blade positions) run with telemetry on, to
measure a distribution rather than one verdict. Runner:
`src/lib/ai/selfplay/decisionCorpus.ts`.

<a id="decisiontrace"></a>**DecisionTrace** — what the Brain considered for one
move: every root candidate, its visits and mean reward, the evaluation
breakdown. Shown in the Debug panel; never affects the move.

## Naming the failure

<a id="blunder"></a>**Blunder** — a move outside the acceptable set in a
position where the gap is unambiguous and large. The class the blade suite
measures; "slightly worse on average" is not a blunder, it is a ladder matter.

<a id="tie"></a>**Tie (rollout noise)** — two candidates whose rewards fall
inside the [indifference band](#indifference-band), so the pick depends on
which seed's rollouts happened to favour which. Reproduces on some seeds only.
The fix is never "tune the score": it is a missing axis that separates two
positions the evaluation sees as identical.

<a id="per-card-knowledge"></a>**Per-card knowledge** — a rule that names a
specific card ("don't cast Damnation on an empty board", "Splinter Twin +
Deceiver Exarch is a combo"). Rejected as a knowledge source since the first
map (`#1254`): the Bot learns from Op semantics and search, and a fix moves the
whole class of cards that share the shape.

<a id="dsl-semantic-layer"></a>**DSL semantic layer** — the collective name for
[valuers](#valuer), [beneficence](#beneficence), [feature basis](#feature-basis)
and [`aiEffects`](#aieffects): everything that lets the Brain price a card it
has never seen from the Effect Script that defines it.

---

## Where this vocabulary comes from

Map `#1254` (credible opponent: blade suite, choice nodes, valuers) and map
`#1892` (strength ceiling: telemetry, ladder, calibration, priors, fitted
eval); ADR 0015 (horizon), 0016 (choices), 0018 (evaluation), 0020 (timing),
0070 (blade admission), 0074 (authority); research
`docs/research/ismcts-choice-nodes.md`, `docs/research/decision-telemetry.md`
and `mcts-small-budget-strength.md` (branch `research/mcts-small-budget`).
Operating procedure for changing the Bot: `.claude/skills/bot-slice/SKILL.md`.
