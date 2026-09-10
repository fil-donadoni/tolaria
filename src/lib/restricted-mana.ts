import { tryGetDefinition } from "@convex/cards";
import type { RestrictedMana } from "~/types/game";

/** Human-readable spend restriction for a unit of restricted mana
 *  (CR 106.6, ADR 0022 / 0042). Drives the label rendered next to the mana
 *  symbol in the pool so the player can tell WHY this mana is set apart from
 *  ordinary pool mana and what it can pay for.
 *
 *  - `castableCardId` (Ice Cauldron, CR 601.3): mana spendable only to cast
 *    one specific exiled card. Resolves the card's printed name for the label.
 *  - `restriction` (Mishra's Workshop / Adarkar Unicorn / Delighted Halfling,
 *    etc.): a spell-class, supertype, or cumulative-upkeep restriction.
 *  - `cantBeCounteredRider` (Delighted Halfling, issue #1559) and
 *    `hasteRider` (Arena of Glory, issue #3354): CR 106.6 riders, appended to
 *    whichever base label applies — orthogonal to `restriction`, so they can
 *    combine with any of them and with each other.
 *
 *  With neither `restriction` nor `castableCardId`, a unit is here ONLY
 *  because a rider tagged it (CR 106.6, issue #3354): it is spendable on
 *  anything, so the base label says exactly that rather than lying with
 *  "Restricted", which is kept for the genuinely unlabelled fallback. */
export function restrictedManaLabel(
    unit: RestrictedMana,
    resolveCardName?: (instanceId: string) => string | undefined
): string {
    if (unit.castableCardId) {
        const name = resolveCardName?.(unit.castableCardId);
        return name ? `Only: ${name}` : "Only: exiled card";
    }
    const riders: string[] = [];
    if (unit.cantBeCounteredRider) riders.push("can't be countered");
    if (unit.hasteRider) riders.push("creature spell gains haste");
    const base = (() => {
        if (unit.restriction === undefined) {
            return riders.length > 0 ? "Any spell" : "Restricted";
        }
        switch (unit.restriction) {
            case "creature-spell":
                return "Creature spells only";
            case "artifact-spell":
                return "Artifact spells only";
            case "cumulative-upkeep":
                return "Cumulative upkeep only";
            case "artifact-ability":
                return "Artifact abilities only";
            case "legendary-spell":
                return "Legendary spells only";
            default:
                return "Restricted";
        }
    })();
    return riders.length > 0 ? `${base} — ${riders.join(", ")}` : base;
}

/** Resolves the printed name of a card definition id (NOT an instance id) for
 *  restriction labels. Ice Cauldron's `castableCardId` is an INSTANCE id, so the
 *  caller must map instance → def id (via the board) before using this; kept
 *  here only as the def-name lookup primitive. */
export function cardDefName(defId: string): string | undefined {
    return tryGetDefinition(defId)?.name;
}
