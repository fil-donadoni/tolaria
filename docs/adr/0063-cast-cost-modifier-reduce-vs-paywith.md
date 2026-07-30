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

## Amendment: convoke, hybrid pips, can't-spend-mana (#1338)

The fast-follow landed. Hogaak, Arisen Necropolis (`{5}{B/G}{B/G}`) exercises the whole cluster; the rails above carried it at low cost, exactly as predicted.

- **Convoke (CR 702.51) is the COLOURED `payWith`.** Modeled as a second Model-2 pre-payment picker — `PendingCast.convokeCreatureChoice`, a **creature** picker (never auto-picked; tapping your best blocker is tactical). Unlike delve (generic-only) a tapped creature pays a generic pip, a single-colour pip, OR a guild-hybrid pip (a creature of either colour). Summoning sickness does **not** block a convoke tap (CR 702.51e — not a `{T}` cost). Owned by `convex/gre/payWith.ts` (`spellHasConvoke`, `convokeEligibleCreatures`, `creatureConvokeColors`, `buildConvokeCreatureChoice`) and the shared greedy `coverColoredAndHybridPips`, which the castability probe (`coloredCostLeftover`) reuses so probe and payment can't diverge. Payment: `recordConvokeCreaturePick` / the `selectConvokeCreatures` mutation; creatures tap at cast commit.
- **Guild-hybrid pips are a narrow `ManaCost.hybrid` field.** `Array<[Color, Color]>`, one entry per `{B/G}`-style pip. `manaValue` counts each +1 (CR 202.3f), `getColorsFromCost` folds both colours in (CR 105.2). At the time of this amendment, deliberately **out**: monocolour-hybrid (`{2/B}`), Phyrexian-hybrid, and land-based hybrid **auto-tap** payment (paying `{B/G}` from a Swamp) — the last tracked-by #782. `normalizeManaCost` kept hybrid pips OUT of the flat generic/colour record; they were satisfied only by the convoke path, sound because the only shipped hybrid card forbade spending mana.

    **Amendment 2 (PRD #1736, #782 closed):** land-based hybrid auto-tap landed
    in #1738/#1739 — `normalizeManaCost` now folds guild-hybrid pips into
    composite `"R/W"`-style keys and the land auto-tap solver settles them
    directly, no convoke required. Figure of Destiny/Figure of Fable, Lutri,
    Lurrus, Deathrite Shaman, Thopter Foundry and the ECL evoke trio
    (Carnage Interpreter, Vibrance, Deceit, Wistfulness) all pay real
    guild-hybrid pips this way (#1755, #1926, #1927). Still out: monocolour
    hybrid `{2/W}` (tracked-by #1743) and Phyrexian-hybrid (no consumer,
    closed out-of-scope).

- **`cantSpendManaToCast` (CR 601.2f) is a generic `CardDefinition` flag.** It drops ALL real mana sources from `coloredCostLeftover`'s probe, forcing every pip through convoke/delve; the payment path drives `manaCost` to zero via the pickers so `solveSmartAutoTap` taps nothing (with a guard in `autoTapForPayment` so a mid-cast auto-tap never spends mana). Since delve pays only generic, Hogaak's two `{B/G}` pips must be convoked by black-or-green creatures.
- **Prompt ordering.** Convoke prompts FIRST (it alone pays the hybrid pips + reduces the generic); the delve picker is built afterwards, on the reduced cost, by `recordConvokeCreaturePick`. Commit gates on convoke before delve.
- **Intrinsic graveyard cast.** Hogaak's "You may cast this card from your graveyard" is a new `CardDefinition.castableFromOwnGraveyard` flag + a `locateCastSource` branch + a `getLegalActions` branch — distinct from Flashback/Escape (alternative cost) and the external Yawgmoth's-Will/Lurrus permissions; the card resolves and lands in the graveyard normally (no exile-on-resolve).
- **Bot / UI.** New compile-time-exhaustive `BotAction` kind `convoke-creatures` (+ `botActionRealisation` branch + `selectConvokeCreatures` driver mutation + `chooseConvokeCreatures` minimal-covering-set picker). UI: `src/components/board/convoke-creature-dialog.tsx` (sibling of the delve exile dialog).
- **affinity** stays `planned` — no pooled card needs it.
