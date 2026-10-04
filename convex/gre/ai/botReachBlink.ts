/**
 * What the Bot-play sweep puts on the CASTER's battlefield for a spell that
 * exiles a creature its caster controls and returns it to the battlefield
 * (CR 400.7, CR 603.6a, issue #4839).
 *
 * A blink is worth the enters-the-battlefield trigger it replays. On the
 * position's filler creatures (vanilla bodies) it changes nothing, so the
 * caster pays mana, and a rebound cast, to move a creature out and back in and
 * passing is right. The spell read `never-chosen` — a limit of the harness,
 * not a fact about the Bot. The caster's board learns the shape instead: a
 * creature whose enters trigger removes an opposing creature, so the blink
 * has a payoff the caster can want.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import type { CardDefinition } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";

/** The caster's creature whose enters trigger a blink replays. */
const BLINK_PAYOFF: ScenarioCard = {
    name: "Flametongue Kavu",
    owner: "me",
    zone: "battlefield",
};

/** Does the script move a bound (earlier-exiled) object back onto the
 *  battlefield, at any depth? */
function returnsBoundToBattlefield(node: unknown): boolean {
    if (Array.isArray(node)) return node.some(returnsBoundToBattlefield);
    if (node === null || typeof node !== "object") return false;
    const rec = node as Record<string, unknown>;
    const target = rec.target as Record<string, unknown> | undefined;
    if (
        rec.op === "moveZone" &&
        rec.to === "battlefield" &&
        target !== undefined &&
        typeof target.ref === "string"
    )
        return true;
    return Object.values(rec).some(returnsBoundToBattlefield);
}

/** The caster's permanent the position hands a blink spell, or none. */
export function blinkPose(def: CardDefinition): ScenarioCard[] {
    if (!def.types.some((t) => t === "Instant" || t === "Sorcery")) return [];
    if (def.targetRequirement?.type !== "Creature") return [];
    if (def.targetRequirement.controller !== "you") return [];
    if (!returnsBoundToBattlefield(def.effects ?? [])) return [];
    return [{ ...BLINK_PAYOFF }];
}
