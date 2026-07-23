# Blade scenario admission: forced-loss fairness, declared budget, engine-real setup

Status: accepted

The blade suite (ADR-adjacent: PRD #1423, issues #1427/#1434) is the correctness
metric for the bot. A metric is only worth the discipline around what may enter
it, so four rules govern admission. They are recorded here because each one
rejects the obvious alternative, and because every future entry copies them.

## 1. Fairness is by construction, not by margin

An entry qualifies as a blade only when the wrong move loses something **forced
by the rules** — a creature, the game. "Worse on average" does not qualify.

The rejected alternative was a numeric margin threshold read off the search
trace. It is circular: the margin is produced by the same evaluation the suite
exists to tune, so tuning the weights makes the fairness check and the scenario
pass together. A test that approves itself is not a metric.

Consequence: a `must` entry must be shown to **bite** — red before the fix it
guards, verified by inverting the fix, not merely observed green. An entry that
was never red is indistinguishable from a vacuous one.

Consequence: when the bot fails a position, the position's fairness is checked
first. A position that cannot be stated as "the forbidden move loses X by force"
without the words "probably" or "on average" is tightened or dropped — it is not
a licence to tune weights against noise.

## 2. The iteration budget is a realism constraint, not a CI cost knob

Production search runs at `DEFAULT_BUDGET = { iterations: 400 }`. Blade entries
declare their budget **before** the position is tuned, in the same order of
magnitude, and raising it is not a legitimate way to turn an entry green: a
position that passes only far above production describes a bot no player will
ever meet.

A position that needs more is recorded as `stretch` **with its cause
classified** — too many candidates at one decision, a payoff beyond the rollout
horizon, or a hidden-information coincidence that rarely occurs in a
determinized world. The classification is the point: each cause names a missing
piece of knowledge (priors, valuation, opponent model), whereas "needs more
iterations" names a compute shortfall that buying more compute never fixes —
linear depth against exponential branching.

Measured at authoring time: the charter Stifle position resolves correctly at
100 iterations across five seeds, so the constraint costs nothing on the
positions that belong in `must`.

## 3. Charter entries run K≥3 seeds

The suite's default is one seed. Charter entries override it: if the right move
is forced by the rules (rule 1), it must hold on any seed. Passing on one seed
and failing on another is evidence the position is not forced, or that the bot
is right by noise — and the response is to demote or tighten it, never to search
for the seed that passes.

## 4. Positions with a pending decision are reached through the real engine

Three of the four charter scenarios assert on a decision that does not exist at
the start of a position — a trigger on the stack, a live search-library choice,
a modal choice. `ScenarioSpec` cannot express any of them.

Two alternatives were rejected:

- **Extend `ScenarioSpec` with stack / pending-choice seeding.** It widens a
  shape shared with the Debug panel and the `debugScenarios` DB path, and worse:
  a hand-seeded stack can describe a state the engine could never produce. The
  bot would then be measured on a position that does not occur in play, which
  destroys the suite's claim to be a metric of real behaviour.
- **Hand-build the state per entry** (the shape the pre-existing
  `dreadnought-stifle.bot.test.ts` uses, whose comment admits it "mirrors
  `processPendingActionTriggers`"). A copy of engine logic does not diverge
  loudly; it diverges silently, which is the defect class this project has been
  bitten by repeatedly.

Chosen instead: an entry declares a small `setup` sequence executed with the
**real** engine functions (`collectTriggers` + `placeTriggersOnStack`,
`resolveTopOfStack`, the real activation path). Reachability holds by
construction, and the line that leads to the decision is visible in the diff.

The invariant that separates this from the copy approach: a setup step that
finds no purchase in the real engine **throws**. There is no fallback that
builds the state "as if" — a silent fallback would search a position other than
the one written.

## 5. Global evaluation weights are moved only under duress

No regression net exists for the bot's general strength: the blade suite is
small, the bot test suite asserts structure rather than play quality, and
self-play is not a reliable diagnostic here. Moving a global weight (`W_LIFE`,
`W_CLOCK`, `BLOCK_CAUTION_FRACTION`) to make one scenario pass is therefore an
unmeasurable change — it turns the entry green and says nothing about what it
cost everywhere else.

Preferred instead: add a term whose support is narrow enough to be **exactly
zero** in positions that do not exhibit the pattern, so it cannot degrade what
it does not touch, and can be unit-tested in isolation (pattern present →
non-zero; absent → zero). This mirrors the `staticEffects` + `applies`
discipline the GRE already uses: extend with a narrow predicate rather than
re-parametrize the general case. A global re-weight requires a demonstrated
forcing scenario and a written justification in the commit.
