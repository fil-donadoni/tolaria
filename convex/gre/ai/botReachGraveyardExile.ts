/**
 * What the Bot-play sweep puts in the OPPONENT's graveyard for a spell that
 * exiles a player's graveyard (CR 404.1, CR 406.1, issue #4829).
 *
 * The position's graveyards hold a filler creature that nothing can cast from
 * there, and the evaluator prices a graveyard card at zero unless its owner can
 * reach it (`graveyardReach`, issue #3042). Exiling it was worth nothing, so
 * the spell read `never-chosen` — a limit of the harness, not a fact about the
 * Bot. The graveyard learns the shape instead: a card the opponent can cast
 * from there, so the exile takes something away and casting is an outcome the
 * caster can want.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import type { CardDefinition } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";

/** A card the opponent can cast from its graveyard (flashback). */
const FLASHBACK_CARD = "Firebolt";

/** A `moveZone` to exile that reads from a graveyard, at any depth of the
 *  script. */
function exilesGraveyard(node: unknown): boolean {
    if (Array.isArray(node)) return node.some(exilesGraveyard);
    if (node === null || typeof node !== "object") return false;
    const rec = node as Record<string, unknown>;
    if (rec.op === "moveZone" && rec.to === "exile") {
        const from = rec.fromZones;
        if (Array.isArray(from) && from.includes("graveyard")) return true;
    }
    return Object.values(rec).some(exilesGraveyard);
}

/** The opposing graveyard card the position hands a spell that exiles a
 *  graveyard, or none. */
export function graveyardExilePose(def: CardDefinition): ScenarioCard[] {
    if (!def.types.some((t) => t === "Instant" || t === "Sorcery")) return [];
    if (!def.targetRequirement || Array.isArray(def.targetRequirement))
        return [];
    if (def.targetRequirement.type !== "player") return [];
    if (!exilesGraveyard(def.effects ?? [])) return [];
    return [{ name: FLASHBACK_CARD, owner: "opp", zone: "graveyard" }];
}
