# ADR 0021 — Stronger opponent model & temporal flexibility

**Status:** Proposed (2026-06-17)

**Refines:** [ADR 0001](0001-ai-opponent-client-side-ismcts.md) (the client-side
ISMCTS opponent), [ADR 0015](0015-rollout-terminates-at-turn-boundary.md) (the
turn-boundary rollout horizon), [ADR 0018](0018-forge-style-evaluation-enrichment.md)
(the Forge-scale leaf evaluation), and [ADR 0020](0020-bot-timing-and-option-value.md)
(the timing & option-value levers). It addresses the gap ADR 0020 lever 4 left
open: the bot still cannot HOLD a resource for a later window of the same turn —
keep a combat trick for the block step instead of dumping it at sorcery speed —
because that behaviour was beyond what a soft, rollout-only guardrail could reach.

## Context

ADR 0020 fixed three families of timing misplay with deterministic selection- and
eval-level levers (1–3) and one soft rollout guardrail (lever 4). Lever 4 was, by
design, a policy bias only: it stops the rollout default policy modelling
obviously-bad lines as typical play, but it cannot flip a ROOT decision the search
already scores higher on immediate value. The motivating residue — the bot dumps
Giant Growth in precombat main rather than holding it as a combat trick — survived
every lever, and the issue-#209 work documented why: even the canonical ambush
position (a 2/2 + Giant Growth into a 3/3) casts the pump precombat at every search
budget.

The diagnosis (see ADR 0020 §Consequences, and the #209 PR notes) is that the
inability traces to three reinforcing root causes, none of which a rollout-only
guardrail touches:

1. **The rollout default policy is greedy 1-ply and reactive-blind.** It chooses
   the move with the best immediate reward for its mover and never represents
   "wait now to react later". So the line `pass precombat → attack → opponent
blocks → cast the trick in response` — a multi-step, response-conditioned line
   — is essentially never produced in a playout, and the leaf estimates for the
   "hold" subtree are scored as if the trick were simply not used.
2. **The leaf evaluation does not price flexibility.** ADR 0018 values cards in
   hand (latent worth) and the board, but a held instant backed by open mana — the
   ability to RESPOND this turn — carries no value distinct from the card's body.
   So holding and dumping look materially identical at the leaf the instant the
   card is spent, minus the card itself.
3. **The opponent is modelled by the same weak policy.** ISMCTS (ADR 0001) descends
   and rolls out the opponent with the bot's own default policy. A bot that cannot
   represent "hold then react" also cannot anticipate that the opponent will block
   in a way the held trick punishes, so the value of holding is never realised even
   in the tree.

The principled cures — a learned policy/value network (AlphaZero/MuZero-style),
counterfactual regret minimisation for the bluff/timing surface, multiple-observer
ISMCTS, likelihood-weighted determinisation — are powerful but each breaks the
seeded, reproducible search the `ai-diagnosis` regression suite depends on, and
each is a large build. This ADR scopes the **first phase**: the deterministic,
test-reproducible techniques that attack the same three root causes without a
learned component.

## Decision

Strengthen the opponent model and temporal flexibility in **layered,
independently shippable** slices, ordered most-deterministic-first (eval before
rollout before search reachability), mirroring ADR 0020. Every slice stays PURE
and deterministic given a seed, so the existing `ai-diagnosis` episodes and the
seeded `search` tests remain the gate.

1. **Option-value term in the leaf evaluation (eval layer).** `evaluate` gains a
   term for retained REACTIVE FLEXIBILITY: a holdable instant / flash card in hand
   that the player has the open, untapped mana to actually cast this turn. It is
   scoped strictly as "can I respond, and with what, right now" — NOT a second
   accounting of the card's body (which ADR 0018's latent `cardValue` already
   counts), so there is no double count. The term makes holding such a card score
   higher than spending it for no payoff, giving the search a reason to keep the
   option. Lowest risk; pure and ordering-testable.

2. **Stronger, reactive-aware rollout default policy (rollout layer).** The greedy
   1-ply default policy is upgraded so a playout plays more like a competent
   player: it holds a pure instant for a reactive window instead of casting it at
   sorcery speed when there is no payoff, makes sane blocks/attacks, and keeps the
   ADR 0020 §4 guardrails. The point is not perfect play but a default policy whose
   playouts no longer systematically under-value lines that wait — which sharpens
   every leaf estimate AND, because the opponent is rolled out with the same
   policy, makes the bot anticipate competent opposition. Exposed at a dedicated
   seam so the policy's move choice is unit-testable in isolation.

3. **Reactive-line reachability in the tree (search layer).** Even with a better
   policy and eval, the multi-step hold→react line is sparse at the budgets the bot
   actually plays at. This slice biases the tree to EXPLORE reactive casts in their
   proper windows (a progressive-bias / soft-prior nudge toward instant-speed
   responses during combat and on the opponent's turn), so the "hold the trick"
   subtree accumulates enough visits for its real value to surface — letting the
   bot hold at the root and cast in the block step. Highest risk (it shapes search,
   not just a leaf), shipped last, behind the eval and policy slices that already
   carry part of the signal.

The PRD that follows scopes each slice into issues, with the regression episode
each must add. Every slice MUST keep the search deterministic under a fixed seed.

## Consequences

- **+** Targets the actual root causes of the held-resource blind spot (weak
  default policy, flexibility-blind eval, weak opponent model) rather than adding
  another bias the search overrides.
- **+** Slices are independent and ordered by risk: the eval term is a pure,
  bisectable addition; the rollout policy is unit-testable at a seam; the search
  reachability change ships last when the others already help.
- **+** Stays fully deterministic, so the `ai-diagnosis` episodes and seeded
  `search` tests remain valid regression gates — no training infrastructure, no
  reproducibility loss.
- **−** Slices 1–2 touch the ADR 0018 leaf eval and the rollout policy that the
  ADR 0020 levers also tuned; magnitudes shift, so the `search.ts` reward band and
  the issue-#138 tie-break must be re-checked, gated on the existing combat/lethal
  and ADR 0020 episodes staying green.
- **−** A reactive-aware default policy costs more per playout ply (it does a small
  amount of lookahead / windowing rather than a flat 1-ply argmax), reducing
  iterations per second; bounded, and the option-value eval reduces how much the
  result leans on rollout depth.
- **−** Slice 3 shapes the search itself; an over-aggressive reactive prior would
  waste iterations exploring pointless instant casts. Mitigated by keeping it a
  soft prior (never a hard expansion rule) and shipping it last.

## Alternatives rejected (this phase)

- **Learned policy + value network (AlphaZero/MuZero self-play).** The most
  complete cure — fixes weak rollout and weak opponent model at once and supplies a
  strong eval. Deferred: it requires self-play training infrastructure and breaks
  the seeded, reproducible search the regression suite is built on (would force the
  `ai-diagnosis` episodes from exact-move assertions to statistics over N seeds).
  A candidate for a later phase, behind frozen weights.
- **Counterfactual regret minimisation (CFR) / depth-limited subgame solving.** The
  principled framework for the hidden-information, bluff/timing surface (the
  Poker-engine lineage). Deferred for the same determinism/complexity reasons; it
  is the right tool if explicit bluffing and mixed strategies become a goal.
- **Multiple-observer ISMCTS and likelihood-weighted determinisation.** Cure the
  strategy-fusion / non-locality pathologies of single-observer ISMCTS and stop the
  bot assuming impossible opponent hands. Real improvements to the opponent model,
  but a larger structural change than this phase wants; revisit once the
  deterministic policy/eval slices land.
- **Explicit instant-speed option-value modelling as a large new eval concept.**
  ADR 0020 already rejected this as too big a tuning surface with double-count risk.
  This ADR takes the bounded version (a single reactive-availability term, slice 1)
  rather than a full option-value subsystem.
- **Do nothing — let bigger search budgets resolve it.** The #209 work showed the
  ambush line is not found even at 20k iterations, because the default policy never
  produces it and the eval never rewards the hold. More iterations do not fix a
  blind policy or a flexibility-blind leaf. Rejected.
