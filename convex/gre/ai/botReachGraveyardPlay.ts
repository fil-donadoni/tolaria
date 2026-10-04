/**
 * What the Bot-play sweep puts in the HOLDER's graveyard for a spell that lets
 * its controller play lands and cast spells from that graveyard this turn
 * (CR 404.1, CR 601.2, issue #4835).
 *
 * "Until end of turn, you may play lands and cast spells from your graveyard"
 * is worth the cards it unlocks. On the position's filler graveyard (one
 * creature) the permission reaches almost nothing, so the caster pays three
 * mana and its own card to change nothing and passing is right. The spell read
 * `never-chosen` — a limit of the harness, not a fact about the Bot. The
 * graveyard learns the shape instead: a few cheap spells and a land, so the
 * permission opens plays the caster can want.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import type { CardDefinition } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";

/** The graveyard cards the permission reaches: spells to cast, a land to play. */
const GRAVEYARD_PLAYABLES: readonly ScenarioCard[] = [
    { name: "Lightning Bolt", owner: "me", zone: "graveyard", count: 2 },
    { name: "Grizzly Bears", owner: "me", zone: "graveyard", count: 2 },
    { name: "Forest", owner: "me", zone: "graveyard" },
];

/** Does the script grant the controller graveyard play, at any depth? */
function grantsGraveyardPlay(node: unknown): boolean {
    if (Array.isArray(node)) return node.some(grantsGraveyardPlay);
    if (node === null || typeof node !== "object") return false;
    const rec = node as Record<string, unknown>;
    if (rec.op === "grantGraveyardPlay" && rec.player === "controller")
        return true;
    return Object.values(rec).some(grantsGraveyardPlay);
}

/** The graveyard cards the position hands a spell that grants graveyard play,
 *  or none. */
export function graveyardPlayPose(def: CardDefinition): ScenarioCard[] {
    if (!def.types.some((t) => t === "Instant" || t === "Sorcery")) return [];
    if (!grantsGraveyardPlay(def.effects ?? [])) return [];
    return GRAVEYARD_PLAYABLES.map((card) => ({ ...card }));
}
