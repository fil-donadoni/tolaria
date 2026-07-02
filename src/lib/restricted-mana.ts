import { tryGetDefinition } from "@convex/cards";
import type { RestrictedMana } from "~/types/game";

/** Human-readable spend restriction for a unit of restricted mana
 *  (CR 106.6, ADR 0022 / 0042). Drives the label rendered next to the mana
 *  symbol in the pool so the player can tell WHY this mana is set apart from
 *  ordinary pool mana and what it can pay for.
 *
 *  - `castableCardId` (Ice Cauldron, CR 601.3e): mana spendable only to cast
 *    one specific exiled card. Resolves the card's printed name for the label.
 *  - `restriction` (Mishra's Workshop / Adarkar Unicorn, etc.): a spell-class
 *    or cumulative-upkeep restriction.
 *
 *  Falls back to a generic "Restricted" label when neither is set. */
export function restrictedManaLabel(
    unit: RestrictedMana,
    resolveCardName?: (instanceId: string) => string | undefined
): string {
    if (unit.castableCardId) {
        const name = resolveCardName?.(unit.castableCardId);
        return name ? `Only: ${name}` : "Only: exiled card";
    }
    switch (unit.restriction) {
        case "creature-spell":
            return "Creature spells only";
        case "artifact-spell":
            return "Artifact spells only";
        case "cumulative-upkeep":
            return "Cumulative upkeep only";
        default:
            return "Restricted";
    }
}

/** Resolves the printed name of a card definition id (NOT an instance id) for
 *  restriction labels. Ice Cauldron's `castableCardId` is an INSTANCE id, so the
 *  caller must map instance → def id (via the board) before using this; kept
 *  here only as the def-name lookup primitive. */
export function cardDefName(defId: string): string | undefined {
    return tryGetDefinition(defId)?.name;
}
