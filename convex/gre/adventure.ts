// CR 715 — the ADVENTURE cast mode (ADR 0120).
//
// Casting an adventurer card as an Adventure is not a second casting channel.
// It is one entry in the cast-option list that evoke / dash / bestow / morph /
// overload already occupy — an `alternativeCostId` announced under CR 601.2b —
// and this module owns the three things that makes it: the id, the cost, and
// the identity SWAP that turns the object on the stack into the inset half.
//
// Why an alternative cost and not a parallel `castAs` channel: `alternativeCostId`
// is the ONE string that says "which cast option was announced", and
// `gre/castPermissions.ts` names its five consumers as an invariant that must
// not drift (the timing gate, the cast-option list, `announceCast`,
// `enumerateCastMoves`, the client picker). A second channel would duplicate
// exactly that drift surface, and every site that forgot to read it would offer
// the cast and then resolve the wrong half (ADR 0120 §3). The channel already
// carries an id that is not the card's printed price at all — morph's, where
// the {3} belongs to the rule — so an Adventure's is no stretch.
//
// Two subrules do the work, and they pull in opposite directions:
//
//   * CR 715.3a — "when casting an adventurer card as an Adventure, ONLY the
//     alternative characteristics are evaluated to see if it can be cast." The
//     subject of timing, affordability and targeting is therefore the TWIN, and
//     every one of those runs BEFORE a stack item exists. A stamp applied to a
//     freshly-built stack item arrives too late to make an instant-speed
//     Adventure legal — which is why `CAST_MODE_CENSUS` grew a `subject`
//     member (`castMode.ts`) rather than this module growing five conditionals.
//   * CR 715.4 — "in every zone except the stack, and while on the stack not as
//     an Adventure, an adventurer card has only its NORMAL characteristics."
//     So the swap is scoped to the stack item and the front id is retained for
//     the revert, the way `transformedFrom` retains it.

import {
    castableInsetKind,
    insetSpellDefinitionId,
    parentIdOfInsetSpell,
} from "../cards/insetSpell";
import { tryGetDefinition } from "../cards";
import type { AlternativeCost, CardDefinition } from "../cards/types";
import type { CardInstanceState } from "./state";

/** Namespace prefix for the `alternativeCostId` that announces an Adventure
 *  cast. Mirrors `CAST_PERMISSION_ALT_COST_PREFIX`'s shape (`castPermissions.ts`)
 *  so the two namespaced spaces and the card-declared one cannot collide. */
export const ADVENTURE_CAST_ALT_COST_PREFIX = "adventure:";

/** The `alternativeCostId` that announces `def`'s Adventure cast. Carries the
 *  parent's id rather than a bare constant (morph's shape) because the twin's
 *  identity is what the stamp needs and an id is the only thing a search `Move`
 *  transports. */
export function adventureCastAltCostId(def: CardDefinition): string {
    return `${ADVENTURE_CAST_ALT_COST_PREFIX}${def.id}`;
}

/** `true` when `altCostId` addresses an Adventure cast rather than a card's own
 *  alternative cost or a board permission's free cast. */
export function isAdventureCastAltCostId(altCostId: string): boolean {
    return altCostId.startsWith(ADVENTURE_CAST_ALT_COST_PREFIX);
}

/** CR 715.2a — the twin `CardDefinition` for `def`'s Adventure, or `undefined`
 *  when the card has none. Resolved through the registry, never rebuilt: the
 *  twin was registered at hydration (`preloadDefinitions`), so this is the same
 *  object every other def-derived reader sees. */
export function adventureTwin(
    def: CardDefinition | undefined
): CardDefinition | undefined {
    // `castableInsetKind`, not `hasAdventure`: the question here is whether the
    // PARENT may cast this half, which CR 722.3 answers differently for a
    // prepare spell, and `INSET_SPELL_KINDS` is the one table that says so.
    const kind = castableInsetKind(def);
    if (kind !== "adventure") return undefined;
    return tryGetDefinition(insetSpellDefinitionId(def!.id, kind)) ?? undefined;
}

/** CR 715.3 — the synthesized cast option for an adventurer card, or
 *  `undefined` for a card with no Adventure.
 *
 *  The cost IS the twin's printed mana cost, so this is not a discount: it is
 *  an alternative cost in the CR 118.9 sense only because the engine has one
 *  channel for "this cast announces something other than the printed spell",
 *  and CR 715.3 is such an announcement. Keyed on the twin actually being
 *  registered — a parent whose twin failed to hydrate offers no option at all
 *  rather than an option that cannot resolve (fail closed). */
export function adventureCastAlternativeCost(
    def: CardDefinition | undefined
): AlternativeCost | undefined {
    const twin = adventureTwin(def);
    if (!twin) return undefined;
    return {
        id: adventureCastAltCostId(def!),
        // The picker row names the half being cast — the one thing the player
        // is choosing. `alt-cost-picker.tsx` renders `description` verbatim.
        description: `Cast ${twin.name} — ${twin.oracleText ?? ""}`.trim(),
        ...(twin.manaCost ? { mana: twin.manaCost } : {}),
    };
}

/** THE Adventure cast option for a card INSTANCE — `adventureCastAlternativeCost`
 *  plus the one thing a definition cannot answer: CR 715.3d's "it can't be cast
 *  as an Adventure this way."
 *
 *  That restriction rides the PERMISSION, not the zone, so it is a property of
 *  the exiled instance (`castFromExileNotAsAdventure`) rather than of exile
 *  itself — 715.3d is explicit that "other effects that allow a player to cast
 *  it may allow a player to cast it as an Adventure". Call THIS from every
 *  surface that offers or accepts the option (`affordableAlternativeCosts`,
 *  `getLegalActions`, `enumerateCastMoves`, `announceCast`), never
 *  `adventureCastAlternativeCost` directly: a surface that skipped the check
 *  would re-offer the very cast the card just exiled itself for. */
export function adventureCastOptionFor(
    card: CardInstanceState
): AlternativeCost | undefined {
    if (card.castFromExileNotAsAdventure === true) return undefined;
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return undefined;
    return adventureCastAlternativeCost(tryGetDefinition(cardId) ?? undefined);
}

/** True iff `alt` is THIS card's CR 715.3 Adventure cast option. Keyed on the
 *  id AND on the card actually having an Adventure, the same fail-closed shape
 *  `isMorphCastAlternativeCost` uses: a card that declared an ordinary
 *  `alternativeCosts[]` entry with a colliding id could not smuggle an identity
 *  swap onto a card with no inset spell. */
export function isAdventureCastAlternativeCost(
    def: CardDefinition | undefined,
    alt: AlternativeCost | undefined
): boolean {
    return isAdventureCastId(def, alt?.id);
}

/** The id form of {@link isAdventureCastAlternativeCost} — what a search `Move`
 *  and the `announceCast` mutation both carry. */
export function isAdventureCastId(
    def: CardDefinition | undefined,
    altCostId: string | undefined
): boolean {
    if (altCostId === undefined || castableInsetKind(def) !== "adventure") {
        return false;
    }
    return altCostId === adventureCastAltCostId(def!);
}

/** CR 715.3b — "while on the stack as an Adventure, the spell has only its
 *  alternative characteristics."
 *
 *  Swaps the stack item's identity to the twin and records the front id for the
 *  CR 715.4 revert, the `faceDown.ts` / `transform.ts` idiom. Idempotent, like
 *  every census stamper: a re-walked commit path cannot double-apply, and the
 *  second call cannot lose the front id.
 *
 *  Deliberately NOT a layer rebuild. `turnFaceDown` replays layers 2–7 because
 *  turning face down is not a zone change and the permanent keeps its own
 *  overlays (CR 400.7 / issue #1705); this object has just ARRIVED on the stack
 *  from the hand, carries no overlays, and CR 715.3b says it has ONLY the
 *  alternative characteristics — so the live arrays are written outright. */
export function castAsAdventure(item: CardInstanceState): void {
    if (item.adventureOf !== undefined) return;
    const frontId = (item.card as { id?: string }).id;
    const def = frontId ? tryGetDefinition(frontId) : null;
    const twin = adventureTwin(def ?? undefined);
    if (!frontId || !twin) return;
    item.adventureOf = frontId;
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

/** CR 715.4 — the object stops being on the stack as an Adventure, so it has
 *  only its normal characteristics again. Restores the front id and clears the
 *  mark; no-op for an object that was never cast as an Adventure.
 *
 *  Applied where the resolved or countered spell LEAVES the stack (`state.ts`),
 *  never on the stack itself: while it is there, CR 715.3b keeps the twin. */
export function revertAdventureIdentity(item: CardInstanceState): void {
    const frontId = item.adventureOf;
    if (frontId === undefined) return;
    const def = tryGetDefinition(frontId);
    delete item.adventureOf;
    if (!def) return;
    item.card = { id: def.id };
    item.types = [...def.types];
    item.subtypes = [...(def.subtypes ?? [])];
    item.staticAbilities = [...(def.staticAbilities ?? [])];
    if (def.power !== undefined) item.power = def.power;
    if (def.toughness !== undefined) item.toughness = def.toughness;
}

/** CR 715.3d — `true` when this stack item was cast as an Adventure, i.e. when
 *  its resolution exiles it instead of putting it into its owner's graveyard.
 *  A COUNTERED Adventure never reaches that site and so is correct by
 *  construction: it goes to the graveyard by the ordinary path. */
export function wasCastAsAdventure(item: CardInstanceState): boolean {
    return item.adventureOf !== undefined;
}

/** The parent card id behind a twin id, for a reader holding only the id.
 *  Re-exported here so `gre/**` has one import site for the Adventure vocabulary
 *  rather than reaching into `cards/insetSpell.ts` for one function. */
export { parentIdOfInsetSpell };
