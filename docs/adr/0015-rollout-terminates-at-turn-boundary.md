# ADR 0015 — ISMCTS rollout terminates at a turn boundary, not a fixed ply count

**Status:** Accepted (2026-06-16)

**Refines:** [ADR 0001](0001-ai-opponent-client-side-ismcts.md) (the rollout
truncation parameter of the client-side ISMCTS opponent).

## Context

The vs-AI opponent (ADR 0001) is an ISMCTS search over the real GRE. Each
search iteration descends the tree, then plays a **truncated rollout** forward
to a leaf and scores it with `evaluate`. The rollout is bounded by
`ROLLOUT_DEPTH = 8` **plies**, where a ply is one decision by whoever holds
priority (pass, cast, declare attackers, declare blockers, …).

A fixed-**ply** horizon is asymmetric with respect to passing:

- When the bot **acts**, it keeps acting on its own turn — the rollout spends
  its limited plies on bot-favorable development, and the leaf is scored before
  the opponent replies.
- When the bot **passes**, it immediately cedes plies to the opponent's turn —
  the opponent develops, and the leaf is scored _after_ that development.

So "do something on my own turn" buys more of the scarce rollout budget than
"pass" does. The search therefore exhibits a **systematic action bias**: it
prefers _any_ action over passing, including strictly wasteful ones.

This was reproduced empirically with the diagnosis harness
(`convex/gre/__tests__/ai-diagnosis.test.ts`). At the medium budget the bot
actually plays at (400 iterations), it casts **Braingeyser with X = 0** —
drawing zero cards for a card plus two mana — rather than passing. Every neutral
action outranks `pass` at 400 iterations; the bias only washes out around
~20,000 iterations, far beyond the live budget.

Crucially, the **leaf evaluation is not at fault**: the immediate post-pass
position (more untapped mana, the spell still in hand) already scores higher
than the wasteful cast. The defect is the **asymmetric horizon** of the rollout,
not the weights. (Two earlier "dumb play" reports — a suicidal 2/2-into-3/3
attack, and Braingeyser gifting the opponent draws — were shown by the same
harness to be already handled: the issue-#138 margin tie-break and the
opponent-hand term in `evaluate` respectively.)

## Decision

Terminate each rollout at a **game-clock boundary** — the start of the bot's
next turn (optionally + K full turns) — instead of after a fixed number of
plies. Every candidate is then scored after a **complete round** in which both
players have had symmetric opportunity to act, removing the
who-got-more-plies asymmetry.

Accept the longer rollouts this implies by raising the per-decision time budget
(`DIFFICULTY_BUDGETS.timeMs`) to roughly **1000–2000 ms**. This stays well under
human decision pace and still reads as a fluid, credible opponent.

A hard cap of K turns bounds the rollout against stall loops (board states that
never advance the turn).

## Consequences

- **+** Removes the action bias at the live budget; `pass` competes fairly with
  acting, so the bot stops spending cards/mana for zero effect.
- **+** Leaves are comparable across candidates — all judged at the same
  game-clock horizon rather than at whoever-happened-to-be-acting.
- **−** Longer rollouts mean **fewer iterations per fixed time** → less tree
  width. Mitigated by the higher `timeMs`; the exact depth/width balance is
  tuned empirically with the harness on representative boards.
- **−** Requires a turn-boundary stop condition in the rollout loop and a
  K-turn safety cap; slightly more rollout bookkeeping than a ply counter.
- **Validation (done):** the `it.fails` action-bias episode (`episode A` in
  `convex/gre/__tests__/ai-diagnosis.test.ts`) flipped to passing and is now a
  plain `it(...)`. At the real play budget (400 iterations) the bot no longer
  prefers the strictly-wasteful `Braingeyser X=0` cast: `pass` now out-rewards
  every `X=0` line (it could not under the old ply horizon), and the bot picks
  the genuinely-better `X=1 → self` draw. The combat/lethal scenarios
  (suicidal-attack tie-break, lethal detection) stay green, and the
  Braingeyser-targets-opponent episode (`episode #3`) is now **reliably**
  correct rather than flaky — the gift to the opponent is judged at the same
  game-clock horizon as targeting self, so `bestSelf > bestOpp` deterministically.

## Implementation notes

- `ROLLOUT_DEPTH = 8` (a fixed ply count) is replaced in `search.ts` by a
  turn-clock horizon: `rollout` stops at the START of the bot's next turn
  (`ROLLOUT_EXTRA_BOT_TURNS = 0` extra full turns), bounded by
  `MAX_ROLLOUT_TURNS = 6` and a `MAX_ROLLOUT_PLIES = 300` backstop against stall
  loops. `DEFAULT_BUDGET.timeMs` is raised 300 → **1500 ms** so the 400-iteration
  budget completes despite the longer (full-round) rollouts.
- **Residual, out of scope (ADR 0016 eval work):** at very high budgets
  (~20k iterations) the `X=0` cast begins out-_evaluating_ `pass` again — an
  eval blind spot (drawing zero cards is scored as non-negative), NOT a horizon
  artifact. The horizon fix removes the _action bias_ at the live budget; the
  leaf-eval blindness is the deferred Forge-comparison eval enrichment.

## Alternatives rejected

- **Only raise `ROLLOUT_DEPTH`.** Attenuates the bias but never removes the
  asymmetry, and trades iterations for depth — another magic constant.
- **Pass-aware rollout policy alone** (mover passes when no move improves its
  immediate reward). Reduces playout noise but leaves the structural own-turn
  plies advantage intact. Retained only as an optional complement to the
  turn-boundary horizon.
- **Tempo / whose-turn correction term in `evaluate`.** Leaky and hard to
  calibrate; treats the symptom in the leaf rather than the cause in the
  horizon.
