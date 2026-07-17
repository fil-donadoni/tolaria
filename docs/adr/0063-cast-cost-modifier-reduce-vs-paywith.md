# Cast-cost modifiers: `reduce` vs `payWith`, and delve as a Model-2 payment choice

Status: accepted

## Context

Cube slice #702 needs a cost-modification family covering, first, two singletons: Emry, Lurker of the Loch ("this spell costs {1} less to cast for each artifact you control") and Treasure Cruise (delve). Both shrink the mana a caster actually pays, but by two different Comprehensive-Rules operations, and payment in this engine is **auto-tap** (`solveSmartAutoTap`) — the player never hand-taps lands — which shapes where any player choice can live.

## Decision

Model cast-cost modification as **two engine-internal variants**, derived from the card's keyword / declared reducer, never an authored `castCostModifier` field:

- **`reduce` (CR 601.2f, passive).** A deterministic, count-driven reduction applied before payment. Emry extends the existing `StaticCostModifier.costReduction` seam — the fixed `ManaCost` amount is generalized to a **count-driven amount** (`{1}` × `count(artifacts-you-control)`), plus a **self-host discovery site** so a spell can apply its own reducer before it is a permanent. Reuses the proven 601.2f math and the `minTotalMana` floor; generic-only, colored pips untouched. No prompt.
- **`payWith` (CR 601.2g, chosen resource).** Delve/convoke satisfy pips with a non-mana resource the player picks. Modeled as **Model 2**: a pre-payment pending choice (reduce → `payWith` prompt → auto-tap covers the remainder). Delve **generalizes the existing escape GY-exile picker** from a fixed count to a **variable `0..min(GY, generic-after-reduce)`**, each exiled card offsetting one generic pip.

Ordering per cast: `reduce` → `payWith` prompt → `solveSmartAutoTap` for the leftover.

**Castability** is answered by feeding the `payWith` resources to `solveSmartAutoTap` **as pseudo-sources for a probe only** (colored matching — convoke — comes free from the existing solver); the real payment path never auto-picks. The client gates purely on the server's `legalActions` (`legal.includes("cast")`) — no client-side delve math.

**Prompt policy** is Arena-style: prompt only on a real branch (lands could cover the same pips → tactical → prompt; nothing eligible → skip; partly forced → prompt with the minimum pre-seeded).

## Considered options

- **One unified hook.** Rejected — `reduce` is a 601.2f reduction, `payWith` a 601.2g chosen payment; convoke uniquely pays colored pips. Different CR steps, different choice semantics.
- **`payWith` as solver pseudo-sources for _payment_ (Model 1).** Rejected — the solver would auto-tap your best blocker / auto-exile graveyard synergy fuel, killing a genuinely tactical choice. Kept solver-as-source for the _castability probe_ only, where there is no tactical loss.
- **A bespoke self-cost-reduction field for Emry / a standalone delve picker.** Rejected as card-shaped duplication of `costReduction` and the escape picker respectively (primitive-reuse rule).

## Consequences

- Delve introduces a new variable-count pending-choice shape → a `botActionRealisation` exhaustive-dispatch branch (else the bot stalls casting Treasure Cruise) and a frontend GY-picker surface whose SURFACE test must run through the reducers.
- Any persisted field the delve pending choice adds must be registered in `PERSISTED_OPTIONAL_KEYS`.
- Convoke, the affinity keyword, and Hogaak (hybrid `payWith` pips + "you can't spend mana to cast this spell") are **deferred** to a fast-follow — no other in-scope card exercises them. They inherit these rails at low cost.
