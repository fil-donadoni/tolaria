// Affinity (CR 702.41) — the generalized keyword form of the count-driven
// CR 601.2f self-host cost reduction that shipped with Emry (ADR 0063, issue
// #1337).
//
// 702.41a: "Affinity for [text]" is a static ability that functions while the
//          spell with affinity is on the stack. "Affinity for [text]" means
//          "This spell costs {1} less to cast for each [text] you control."
// 702.41b: "If a spell has multiple instances of affinity, each of them
//          applies."
//
// The engine already does ALL of the work. `CardDefinition.selfCostReduction`
// (ADR 0063) is read at the CR 601.2f apply site (`getCostModifiers`,
// `convex/gre/state.ts`) — the SELF-HOST site, which exists precisely because
// the spell being announced is not a permanent yet, so the ordinary
// battlefield `staticEffects` scan can never discover its own reducer. A
// `CountDrivenCostReduction` there means "subtract `perCount` once per
// `countFilter`-matching permanent on the announcing player's OWN
// battlefield", resolved by `resolveCostReductionGeneric`.
//
// That maps onto 702.41a exactly, with three properties that fall out for
// free rather than needing affinity-specific code:
//   • **generic-only** — `resolveCostReductionGeneric` returns a generic
//     amount and `applyCostModifiers` only ever reduces `manaCost.X`, so
//     Thoughtcast keeps its `{U}` no matter how many artifacts are out
//     (702.41a reduces by {1}, a generic symbol).
//   • **never counts itself** — the scan reads `player.battlefield` and the
//     spell is on the stack while its affinity functions (702.41a), so
//     Frogmite can never discount itself.
//   • **cumulative (702.41b)** — `getCostModifiers` accumulates into a single
//     `reductionGeneric +=`, so two instances stack additively with no
//     special case.
//
// So this file is a pure CARD-LAYER factory, not engine code: it pairs the
// board-visible `staticAbilities` reminder string with the `selfCostReduction`
// data that enforces it, exactly the way Dash pairs `dash: {...}` with
// `dashTrigger(name)`. Declaring the two separately on each card would let
// them drift (a card could print the keyword and enforce nothing — the
// deathtouch/hexproof shape Guard A exists to catch); building both from one
// call makes that impossible.
//
// Parametrized by a `PermanentFilter` rather than hardcoding Artifact, so the
// printed non-artifact variants need no new code: "Affinity for Islands"
// (Somber Hoverguard) is `{ subtypes: "Island" }`, "Affinity for Equipment"
// is `{ subtypes: "Equipment" }`.
import type { PermanentFilter, SelfCostReduction } from "../types";

/** What `affinity()` contributes to a `CardDefinition`: the declared keyword
 *  string(s) and the reduction that enforces the affinity one. `staticAbilities`
 *  is REQUIRED (not the optional `CardDefinition` field) so a caller can read
 *  it without a non-null assertion. */
interface AffinityDeclaration {
    staticAbilities: string[];
    selfCostReduction: SelfCostReduction;
}

/** The `staticAbilities[]` string + `selfCostReduction` data for one instance
 *  of Affinity (CR 702.41a). Spread onto a `CardDefinition`:
 *
 *  ```ts
 *  export const frogmite: CardDefinition = {
 *      …,
 *      ...affinity({ quality: "artifacts", filter: { types: "Artifact" } }),
 *  };
 *  ```
 *
 *  The declared string is matched by the Mechanics Registry's
 *  `bindingPattern: /^affinity for /` (the parametrized-keyword mechanism
 *  protection / ward / landwalk already use), so it satisfies both the
 *  name-authority guard and Guard A (keyword-must-be-implemented). */
export function affinity(args: {
    /** The Oracle "[text]" of "Affinity for [text]", lowercase and PLURAL as
     *  printed — "artifacts", "Islands", "Equipment". Goes into the declared
     *  keyword string verbatim, so it must match the printed card. */
    quality: string;
    /** What counts as one "[text] you control". Matched against the
     *  announcing player's own battlefield only (CR 702.41a "you control"). */
    filter: PermanentFilter;
    /** The card's OTHER printed keyword abilities, appended after the affinity
     *  string. A `CardDefinition` has a single `staticAbilities` array, so a
     *  card with affinity AND another keyword (Thought Monitor: flying) must
     *  pass them here — spreading this factory and then re-declaring
     *  `staticAbilities` would silently drop the affinity string, leaving the
     *  reduction unannounced on the board. */
    alsoKeywords?: string[];
}): AffinityDeclaration {
    return {
        staticAbilities: [
            `affinity for ${args.quality.toLowerCase()}`,
            ...(args.alsoKeywords ?? []),
        ],
        selfCostReduction: {
            // CR 702.41a — "costs {1} less to cast for each [text] you
            // control". `{ X: 1 }` is one GENERIC mana (the normalized
            // generic key), never a coloured pip.
            costReduction: { perCount: { X: 1 }, countFilter: args.filter },
            // No `minTotalMana`: affinity has no floor. Frogmite with four
            // artifacts out costs {0} (CR 601.2f — a reduction may take the
            // cost to zero; it just can't go below).
        },
    };
}

/** "Affinity for artifacts" (CR 702.41a) — by far the most-printed variant
 *  (the whole Mirrodin-block affinity cycle). Thin alias over `affinity` so
 *  the common case reads as one call with no filter literal repeated per
 *  card. `alsoKeywords` forwards the card's other printed keywords. */
export function affinityForArtifacts(
    alsoKeywords?: string[]
): AffinityDeclaration {
    return affinity({
        quality: "artifacts",
        filter: { types: "Artifact" },
        alsoKeywords,
    });
}
