// Shared fixture: probe spells whose ALTERNATIVE cost exiles cards from the
// caster's graveyard (CR 118.9 / 701.13) — Spinning Darkness's exact cost
// shape, "You may exile the top three black cards of your graveyard rather
// than pay this spell's mana cost". Spinning Darkness itself is not in the
// catalogue yet (its grammar lands with issue #5279), so the GRE, game.ts,
// wire and bot layers all drive THESE definitions and cannot drift.
//
// Two probes, because the two `game.ts` commit sites differ: the TARGETED
// probe (Spinning Darkness's own "3 damage to target nonblack creature")
// commits through `finalizeTargetSelection`, the UNTARGETED one through
// `announceCast`'s alternative-cost branch.

import type { AlternativeCost, CardDefinition } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import { makeInstance } from "../../../cards/__tests__/setup.helper";
import type { CardInstanceState } from "../../state";

/** The cost under test, exactly as issue #6440 specifies the leg. */
export const EXILE_TOP_THREE_BLACK: AlternativeCost = {
    id: "exile-top-three-black",
    description: "Exile the top three black cards of your graveyard",
    graveyard: {
        action: "exile",
        filter: { color: "B" },
        count: 3,
        position: "top",
    },
};

export const ALT_GRAVEYARD_EXILE_TARGETED_ID =
    "test:alt-cost-graveyard-exile-targeted";
export const ALT_GRAVEYARD_EXILE_UNTARGETED_ID =
    "test:alt-cost-graveyard-exile-untargeted";

export const altGraveyardExileTargetedProbe: CardDefinition = {
    id: ALT_GRAVEYARD_EXILE_TARGETED_ID,
    rarity: "common",
    name: "Graveyard-Exile Probe",
    oracleText:
        "You may exile the top three black cards of your graveyard rather than pay this spell's mana cost.\nThis spell deals 3 damage to target nonblack creature. You gain 3 life.",
    manaCost: { X: 4, B: 2 },
    types: ["Instant"],
    alternativeCosts: [EXILE_TOP_THREE_BLACK],
    targetRequirement: { type: "Creature", count: 1, excludeColors: "B" },
    effects: [
        { op: "dealDamage", amount: 3, to: { target: 0 } },
        { op: "gainLife", player: "controller", amount: 3 },
    ],
};
registerTokenDefinition(altGraveyardExileTargetedProbe);

export const altGraveyardExileUntargetedProbe: CardDefinition = {
    id: ALT_GRAVEYARD_EXILE_UNTARGETED_ID,
    rarity: "common",
    name: "Untargeted Graveyard-Exile Probe",
    oracleText:
        "You may exile the top three black cards of your graveyard rather than pay this spell's mana cost.\nYou gain 3 life.",
    manaCost: { X: 4, B: 2 },
    types: ["Instant"],
    alternativeCosts: [EXILE_TOP_THREE_BLACK],
    effects: [{ op: "gainLife", player: "controller", amount: 3 }],
};
registerTokenDefinition(altGraveyardExileUntargetedProbe);

/** A card in `ownerId`'s `zone`. */
export function ownedCard(
    cardId: string,
    id: string,
    ownerId: string,
    zone: "graveyard" | "hand" | "battlefield"
): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: ownerId,
        ownerId,
        zone,
    });
}
