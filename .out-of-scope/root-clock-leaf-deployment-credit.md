# Crediting a deployment at the root-clock stop

The Brain does not credit, at a rollout leaf, the deployment the Bot's main
phase would make at the root-clock stop. A card in hand that is castable at the
stop keeps its latent discount and its place in the deployment schedule. There
is no quiescence step that plays the Bot's main-phase casts before the leaf, the
stop does not move to the end of that main phase, and a castable card is not
priced at its board worth there.

## Why this is out of scope

The rollout horizon sits on the search root's clock: every leaf of a decision
is scored at the Bot's next precombat main phase (ADR 0015, PRD issue #10815).
Issue #11049 asked how such a leaf should credit a deployment the stop
interrupts. Three shapes were measured on the hosted `must` census, and each
one is refuted.

| Shape                                                                 | Result                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A sorcery-speed creature castable at the stop priced at its body      | 10 new red entries (issue #11032, run 46118892306, base `eaeda6051`)                                          |
| The deployment schedule's decay, a held answer queued behind the hand | the root reward does not move (issue #11032)                                                                  |
| The stop moved to the end of the Bot's next precombat main phase      | 16 new red entries, mean ms per iteration 7.90 → 9.08 (run 46145181639 against 46145178203, base `59007d9e5`) |

**The failures share one mechanism.** A credit for what the Bot deploys at the
stop makes "pass today, deploy at the stop" reach the same leaf as "cast
today" whenever the hand fits in the next turn's mana. Most of the red entries
in both censuses are a `pass` chosen over a cast. Today the difference between
a card on the battlefield and the same card castable in hand is what pays for
casting now; a credit at the stop removes it.

**A consistent version is the scheme already in place.** A bonus read only at
the last state of a finite horizon is not a potential, so it changes which line
ranks first (Ng, Harada and Russell 1999; Grześ 2017 for the finite horizon).
The form that leaves the ranking alone accrues the credit along the path, one
turn of presence at a time, and that sum is what the hand term computes now: a
permanent on the battlefield at full worth, a card castable in the first window
at the latent discount, a later window at the deployment decay on top.

**The position that raised the question does not discriminate.** On the board
of issue #11049 (three Plains, Disenchant and three Savannah Lions in hand, a
library of Savannah Lions, an opposing Trinisphere) the three lines were played
with the engine and the production evaluation (base `59007d9e5`), the opponent
passing and the Bot attacking with everything:

| Line                                     | Reward at the stop | Reward at the end of that main phase | Game over |
| ---------------------------------------- | ------------------ | ------------------------------------ | --------- |
| Disenchant on the Trinisphere now        | 0.715              | 0.750                                | turn 16   |
| Savannah Lions now, Disenchant next      | 0.714              | 0.750                                | turn 16   |
| Savannah Lions every turn, no Disenchant | 0.714              | 0.750                                | turn 16   |

The Disenchant line is ahead by four damage that does not change the turn the
opponent dies, its lead appears one step past the stop and is gone two turns
later, and from the end of that main phase on every line sits on the reward
clip. The evaluation's tie at the stop is the correct reading of three lines on
one clock. The decision the entry was written for is guarded by its six-Plains
board, where the payoff lands inside the turn (issue #11032).

## What would reopen it

A position from play where the Bot loses turns, not overkill damage, because a
leaf at the stop misses a deployment, with the lines' kill turns measured.
A later stop is not that evidence: the six-arm census of PRD issue #10815
already measured the end of the next turn and the turn after it as worse on
both reds and speed.

## Prior requests

- issue #11049 — "search: a root-clock leaf prices the deployment it interrupts
  at the latent discount (horizon effect, three-Plains Trinisphere board)"
