# ADR 0018 — Forge-style evaluation enrichment (card value, danger clock, Forge-scale)

**Status:** Accepted (2026-06-16)

**Refines:** [ADR 0001](0001-ai-opponent-client-side-ismcts.md) (the `evaluate`
leaf heuristic of the client-side ISMCTS opponent). **Resolves the deferral in**
[ADR 0015](0015-rollout-terminates-at-turn-boundary.md) (the residual high-budget
leaf-eval blind spot) and [ADR 0016](0016-bot-resolution-choice-default-policy.md)
(smart resolution-choice selection, gated on this work).

## Context

The vs-AI Bot's leaf heuristic (`convex/gre/evaluate.ts`, issue #111) is a flat
material count: life × 3, **every** card in hand worth a flat 2, creatures
scored by effective power/toughness with a small evasion bonus, plus board
presence and available mana. It is deliberately first-pass — tuned for ordering,
not magnitude — and two consumers have now hit its ceiling:

- **ADR 0015 residual.** Once the rollout horizon was fixed, the bot no longer
  exhibits the structural action bias, but at very high search budgets a
  zero-value play (Braingeyser X = 0) still creeps above `pass`. The cause is the
  leaf, not the horizon: a flat hand term means throwing away a good card for no
  effect costs the same 2 points as discarding a basic land, a difference too
  small to survive the reward band.
- **ADR 0016 deferral.** Mid-resolution choices (`chooseResolution` in
  `src/lib/ai/brain.ts`) fetch/keep/discard by a single bit — `isLand` — so the
  bot tutors a random non-land rather than the best card and discards by no real
  preference. ADR 0016 explicitly gated "smart selection" on this evaluation
  work.

Both gaps are the same missing concept: **the worth of a specific card**, beyond
its raw stats. Forge — the established reference engine (ADR 0001) — solves this
with a derived numeric `evaluateCreature` heuristic plus per-card AI hints
(`SVar:AI*`), and reads the race with a predicted-damage / life-in-danger check.
We adopt that model, scaled to our engine.

## Decision

Introduce one shared, pure `cardValue` primitive and enrich `evaluate` around it,
Forge as the north star throughout. Concretely:

1. **`cardValue` primitive (hybrid source).** A card's worth is _derived_ from
   its characteristics — mana value, base power/toughness, keyword set, type —
   with an optional per-`CardDefinition` `aiValue` override for the cards the
   heuristic grossly misjudges (the Forge `SVar` analog). Derivation keeps the
   primitive scaling to the ~80k-card target (no per-card data required); the
   override is the escape hatch for bombs and duds. Creatures reuse a Forge
   `evaluateCreature` port (base + power-weighted + toughness-weighted + MV +
   keyword bonuses, restricted to the implemented keyword vocabulary, structured
   so new keywords drop in at zero cost). Non-creatures default to
   `base + MV × k` before any override.

2. **Latent vs realized, no double-count.** `cardValue` scores _latent_ worth —
   cards in hand / library / graveyard — and replaces the flat hand term. Cards
   on the **battlefield** keep their _realized_ eval (effective P/T + keywords),
   which sub-problem (1) above also enriches. A card is scored as latent **or**
   realized, never both, so the issue-#138 `materialMargin` tie-break stays
   intact.

3. **Forge-scale magnitudes.** The whole `evaluate` is rescaled to Forge's
   ~100-base magnitudes (a creature in the hundreds, life and card value
   commensurate) instead of the current ~1–3-per-resource scale. This gives the
   numeric headroom to distinguish a bomb from a vanilla and to make a wasted
   card a decisive loss. `WIN_SCORE` still dominates every material margin.

4. **Explicit Danger Clock (symmetric, net-of-blockers).** A new term reads the
   race: each player's estimated turns-to-lethal — life ÷ predicted incoming
   combat damage, net of available blockers (a crude best-block assignment, pure)
   — and the eval rewards holding the faster clock. The Bot therefore both
   defends when threatened and pushes damage when ahead, rather than turtling.
   This estimates the threat **beyond** the rollout's turn-boundary horizon
   (ADR 0015), complementing the one round of realized damage the rollout already
   plays out.

5. **Resolution path gets `cardValue`.** `ChoiceCandidate` carries a projected
   `value` (computed by the shared primitive at `buildBotView` time, where full
   card identity is available) instead of just `isLand`; `chooseResolution`
   orders by value. So tutors fetch the bomb, discards shed the worst, scry keeps
   the best on top. The `value` projection lives on the **bot-only `OwedChoice`
   path** and is never wired into the 2-player `PublicGameState` projection, so it
   can never leak per-card valuations of a hidden opponent hand in real PvP.

## Consequences

- **+** Closes the ADR 0015 residual (a wasted card is a clear loss) and the
  ADR 0016 deferral (resolution choices pick the best card) from one primitive.
- **+** The Bot races: defends under a fast opposing clock, closes out when
  ahead — visibly stronger, more credible play.
- **+** Scales to the full catalog: derivation needs no per-card data; `aiValue`
  annotates only the exceptions.
- **−** The rescale is **hard to reverse**: it ripples through the `search.ts`
  reward band (eval → [0,1] mapping) and the issue-#138 tie-break threshold, both
  of which must be recalibrated. A regression is bisectable only because the work
  ships staged (below).
- **−** A net-of-blockers Danger Clock adds a mini block simulation inside the
  pure `evaluate`; more cost per leaf, partly offset against the ADR 0015 time
  budget.
- **−** More tuned constants. Mitigated by asserting **ordering**, not
  magnitudes, in tests (the existing `evaluate` contract).

## Implementation notes

Staged, foundation-first — each slice ships independently green, with its own
`ai-diagnosis` regression episodes; the existing combat/lethal episodes staying
green through the rescale is the foundation gate:

1. **Rescale + creature eval.** Forge-scale magnitudes, `evaluateCreature` port,
   recalibrate the `search.ts` reward band + #138 tie-break. Verified against the
   existing combat/lethal episodes.
2. **Latent hand value + `aiValue` override.** `cardValue` replaces the flat hand
   term; closes the X = 0 blind spot. New episode: X = 0 decisively rejected,
   bomb kept over land.
3. **Danger Clock.** Symmetric, net-of-blockers race term. New episode: bot
   defends vs races correctly.
4. **Resolution-path projection.** `ChoiceCandidate.value` at `buildBotView`;
   `chooseResolution` orders by value. New tests: tutor picks the bomb, discard
   sheds the worst, across the GRE → game.ts → UI boundary.

Tests assert ordering-level properties so re-tuning weights never breaks them.
The `aiValue` override field is an absolute `cardValue` replacement when present.
The land-drop-strictly-positive invariant (issue #149) must be preserved under
the new scale.

## Alternatives rejected

- **Per-card annotation only.** Precise but does not scale to ~80k cards —
  violates the primitive-reuse constraint. Kept only as the `aiValue` override on
  top of derivation.
- **Unified `cardValue` everywhere** (replacing the board P/T term too).
  Conceptually cleaner but rewrites the combat-tuned eval and risks regressing the
  issue-#138 margin behavior. Rejected for latent-only + separate realized eval.
- **Keep the small scale, compress Forge reasoning into small ints.** Less
  disruptive, but cramped headroom for fine card-quality distinctions and a worse
  1:1 map to Forge's formulas. Rejected in favor of the full rescale.
- **Threat stays emergent from material margin.** The turn-boundary rollout
  surfaces one round of realized damage, but nothing models the clock beyond the
  horizon; the bot misjudges races. Rejected for an explicit Danger Clock.
- **Route resolution choices through the worker/search.** Most powerful (full
  board context) but a big new message path and per-choice latency. Rejected for
  the lightweight `value` projection.
