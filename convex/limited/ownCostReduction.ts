// Own cost reduction — does a card carry a way to be cast for less than its
// mana value? Auto-Build reads it (`AutoBuildCardMeta.reducesOwnCost`): the
// land-drop half of castability (`castability.ts#manaValueCastability`)
// measures a card's MANA VALUE against the deck's mana sources, which would
// read Treasure Cruise as an eight-drop when a deck with a full graveyard
// casts it for one.
//
// A card reduces its own cost when it prints delve (CR 702.66a), convoke
// (CR 702.51a) or improvise (CR 702.126a) — each pays generic mana with
// something other than mana — or carries a `selfCostReduction` (affinity,
// CR 702.41a, and the "costs {N} less for each" family). The reduction's
// size is not read: whether the deck can feed it is a question the build
// does not model, so such a card is simply exempt from the land-drop factor.
//
// Pure: reads the definition only.
import type { CardDefinition } from "../cards/types";

/** The keywords that pay generic mana with something other than mana. */
const OWN_COST_KEYWORDS: readonly string[] = ["delve", "convoke", "improvise"];

/** True when `def` can be cast for less than its mana value by its own text. */
export function reducesOwnCost(def: CardDefinition): boolean {
    if (def.selfCostReduction !== undefined) return true;
    return (def.staticAbilities ?? []).some((k) =>
        OWN_COST_KEYWORDS.includes(k)
    );
}
