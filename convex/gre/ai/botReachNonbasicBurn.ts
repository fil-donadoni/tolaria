/**
 * What the Bot-play sweep puts on the OPPONENT's battlefield for a spell that
 * damages each player by the nonbasic lands that player controls (CR 305.6,
 * CR 120.3a, issue #4828).
 *
 * The caster's own board is basic lands, so on an empty opposing board the
 * spell deals 0 to everyone and passing is right. The position used to hold no
 * opposing nonbasic land, so the card read `never-chosen` — a limit of the
 * harness, not a fact about the Bot. The board learns the shape instead:
 * nonbasic lands on the opponent's side only, so the damage lands on the
 * opponent alone and casting is an outcome the caster can want.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import type { CardDefinition } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";

/** The opposing nonbasic lands posed, enough for the damage to be worth a card. */
const OPPOSING_NONBASIC_LANDS = 3;

/** A nonbasic land with no ability beyond its mana. */
const NONBASIC_LAND = "Volcanic Island";

/** A damage amount counting a player's nonbasic lands, at any depth of the
 *  script. */
function countsNonbasicLands(node: unknown): boolean {
    if (Array.isArray(node)) return node.some(countsNonbasicLands);
    if (node === null || typeof node !== "object") return false;
    const rec = node as Record<string, unknown>;
    if (rec.op === "dealDamage") {
        const text = JSON.stringify(rec.amount ?? null);
        if (text.includes('"excludeSupertype":"Basic"')) return true;
    }
    return Object.values(rec).some(countsNonbasicLands);
}

/** The opposing nonbasic lands the position hands a spell whose damage scales
 *  with them, or none. */
export function nonbasicBurnPose(def: CardDefinition): ScenarioCard[] {
    if (!def.types.some((t) => t === "Instant" || t === "Sorcery")) return [];
    if (!countsNonbasicLands(def.effects ?? [])) return [];
    return [
        {
            name: NONBASIC_LAND,
            owner: "opp",
            zone: "battlefield",
            count: OPPOSING_NONBASIC_LANDS,
        },
    ];
}
