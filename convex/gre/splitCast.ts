// CR 709.3 — casting ONE HALF of a split card (ADR 0121).
//
// "A player chooses which half of a split card they are casting before putting
// it onto the stack." That choice is announced the way every other cast choice
// is (CR 601.2b): as an `alternativeCostId`, the ONE string that says which
// cast option was taken. `gre/castPermissions.ts` names its five consumers as
// an invariant — the timing gate, the cast-option list, `announceCast`,
// `enumerateCastMoves`, the client picker — and a second channel would
// duplicate exactly that drift surface (the argument `adventure.ts` records
// for CR 715.3, unchanged here).
//
// Where split DIFFERS from every other cast mode, and the only place it does:
//
//   * CR 709.3a — "ONLY the chosen half is evaluated to see if it can be cast.
//     Only that half is considered to be put onto the stack." Same shape as
//     715.3a, same answer: the `subject` member of `CAST_MODE_CENSUS`
//     (`castMode.ts`), so timing, affordability and targeting all judge the
//     TWIN, before any stack item exists.
//   * CR 709.3 puts the choice BEFORE the card reaches the stack, so there is
//     no cast that ever puts the combined object there. A split card offers
//     two half options and NO printed cast — `offersPrintedCast`
//     (`cards/splitCard.ts`) is what every offering surface reads, and the
//     reason it is a predicate on the definition rather than a conditional per
//     surface is that a surface that forgot it would offer a `{G}{W}` cast
//     resolving to neither half.
//   * CR 709.4 — "in every zone except the stack, the characteristics of a
//     split card are those of its two halves combined." So the identity swap
//     is scoped to the stack item and the parent id is retained for the
//     revert, exactly as `adventureOf` retains it for CR 715.4.

import { tryGetDefinition } from "../cards";
import {
    offersPrintedCast,
    SPLIT_HALF_SIDES,
    splitHalfDefinitionId,
    type SplitHalfSide,
} from "../cards/splitCard";
import type { AlternativeCost, CardDefinition } from "../cards/types";
import type { CardInstanceState } from "./state";

/** Namespace prefix per side for the `alternativeCostId` that announces a split
 *  half's cast. Mirrors `ADVENTURE_CAST_ALT_COST_PREFIX`'s shape so the
 *  namespaced spaces and the card-declared one cannot collide.
 *
 *  `Record<SplitHalfSide, …>` rather than two constants: a side added to the
 *  union cannot compile without its own prefix, and every scan below iterates
 *  the record instead of naming "left" and "right" a second time. */
export const SPLIT_CAST_ALT_COST_PREFIX: Record<SplitHalfSide, string> = {
    left: "split-left:",
    right: "split-right:",
};

/** The `alternativeCostId` that announces `def`'s `side` half. Carries the
 *  PARENT's id, because that is what a search `Move` transports and what the
 *  stamp needs to resolve the twin. */
export function splitCastAltCostId(
    def: CardDefinition,
    side: SplitHalfSide
): string {
    return `${SPLIT_CAST_ALT_COST_PREFIX[side]}${def.id}`;
}

/** The side `altCostId` announces, or `undefined` when it addresses something
 *  other than a split half's cast. Id-shape only — {@link isSplitCastId} is
 *  the fail-closed form that also proves the card HAS that half. */
export function splitSideOfAltCostId(
    altCostId: string | undefined
): SplitHalfSide | undefined {
    if (altCostId === undefined) return undefined;
    return SPLIT_HALF_SIDES.find((side) =>
        altCostId.startsWith(SPLIT_CAST_ALT_COST_PREFIX[side])
    );
}

/** CR 709.3b — the twin `CardDefinition` for `def`'s `side` half, or
 *  `undefined` when the card has no such half. Resolved through the registry,
 *  never rebuilt: the twin was registered at hydration
 *  (`preloadDefinitions`), so this is the same object every other def-derived
 *  reader sees. */
export function splitTwin(
    def: CardDefinition | undefined,
    side: SplitHalfSide
): CardDefinition | undefined {
    if (!def?.splitHalves) return undefined;
    return tryGetDefinition(splitHalfDefinitionId(def.id, side)) ?? undefined;
}

/** CR 709.3 — the synthesized cast option for one half, or `undefined` for a
 *  card that has none.
 *
 *  The cost IS the half's printed mana cost, so this is not a discount: it is
 *  an alternative cost in the CR 118.9 sense only because the engine has one
 *  channel for "this cast announces something other than the printed spell".
 *  Keyed on the twin actually being registered — a card whose twin failed to
 *  hydrate offers no option at all rather than one that cannot resolve. */
export function splitCastAlternativeCost(
    def: CardDefinition | undefined,
    side: SplitHalfSide
): AlternativeCost | undefined {
    const twin = splitTwin(def, side);
    if (!twin) return undefined;
    return {
        id: splitCastAltCostId(def!, side),
        // The picker row names the half being cast — the one thing the player
        // is choosing. `alt-cost-picker.tsx` renders `description` verbatim.
        description: `Cast ${twin.name} — ${twin.oracleText ?? ""}`.trim(),
        ...(twin.manaCost ? { mana: twin.manaCost } : {}),
    };
}

/** BOTH of `card`'s split-half cast options, left then right — the whole cast
 *  menu for a split card, and empty for every other card.
 *
 *  The instance-level entry point every offering surface calls
 *  (`affordableAlternativeCosts`, `getLegalActions`, `enumerateCastMoves`,
 *  `announceCast`), mirroring `adventureCastOptionFor`. Unlike Adventure's
 *  there is no instance-scoped withdrawal to apply: CR 709 has no counterpart
 *  to 715.3d's "it can't be cast as an Adventure this way". */
export function splitCastOptionsFor(
    card: CardInstanceState
): AlternativeCost[] {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return [];
    const def = tryGetDefinition(cardId) ?? undefined;
    if (!def?.splitHalves) return [];
    const options: AlternativeCost[] = [];
    for (const side of SPLIT_HALF_SIDES) {
        const alt = splitCastAlternativeCost(def, side);
        if (alt) options.push(alt);
    }
    return options;
}

/** The side `altCostId` announces for THIS card, fail-closed: `undefined`
 *  unless `def` really is a split card with that half. The same shape
 *  `isAdventureCastId` uses — a card declaring an ordinary `alternativeCosts[]`
 *  entry with a colliding id could not smuggle an identity swap onto a
 *  non-split card. */
export function isSplitCastId(
    def: CardDefinition | undefined,
    altCostId: string | undefined
): SplitHalfSide | undefined {
    const side = splitSideOfAltCostId(altCostId);
    if (side === undefined || def?.splitHalves === undefined) return undefined;
    return altCostId === splitCastAltCostId(def, side) ? side : undefined;
}

/** CR 709.3b — "while on the stack, only the characteristics of the half being
 *  cast exist. The other half's characteristics are treated as though they
 *  didn't exist."
 *
 *  Swaps the stack item's identity to the twin and records the parent id for
 *  the CR 709.4 revert — the `faceDown.ts` / `adventure.ts` idiom. Idempotent,
 *  like every census stamper: a re-walked commit path cannot double-apply, and
 *  the second call cannot lose the parent id.
 *
 *  Deliberately NOT a layer rebuild: the object has just ARRIVED on the stack
 *  from the hand, carries no overlays, and 709.3b says the other half's
 *  characteristics do not exist — so the live arrays are written outright. */
export function castAsSplitHalf(
    item: CardInstanceState,
    side: SplitHalfSide
): void {
    if (item.splitHalfOf !== undefined) return;
    const parentId = (item.card as { id?: string }).id;
    const def = parentId ? tryGetDefinition(parentId) : null;
    const twin = splitTwin(def ?? undefined, side);
    if (!parentId || !twin) return;
    item.splitHalfOf = parentId;
    item.card = { id: twin.id };
    // Every array is COPIED, never aliased — handing the registry definition's
    // own array to an instance would let any later in-place writer corrupt the
    // catalogue globally (`turnFaceUp`'s note).
    item.types = [...twin.types];
    item.subtypes = [...(twin.subtypes ?? [])];
    item.staticAbilities = [...(twin.staticAbilities ?? [])];
    delete item.power;
    delete item.toughness;
}

/** CR 709.4 — the object stops being on the stack, so its characteristics are
 *  its two halves combined again. Restores the parent id and clears the mark;
 *  a no-op for an object that was never cast as a split half.
 *
 *  Applied where the resolved or countered spell LEAVES the stack (`state.ts`),
 *  never on the stack itself: while it is there, 709.3b keeps the twin. */
export function revertSplitIdentity(item: CardInstanceState): void {
    const parentId = item.splitHalfOf;
    if (parentId === undefined) return;
    const def = tryGetDefinition(parentId);
    delete item.splitHalfOf;
    if (!def) return;
    item.card = { id: def.id };
    item.types = [...def.types];
    item.subtypes = [...(def.subtypes ?? [])];
    item.staticAbilities = [...(def.staticAbilities ?? [])];
    if (def.power !== undefined) item.power = def.power;
    if (def.toughness !== undefined) item.toughness = def.toughness;
}

export { offersPrintedCast };
