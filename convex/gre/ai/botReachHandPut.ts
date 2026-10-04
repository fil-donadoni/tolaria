/**
 * What the Bot-play sweep puts in the holder's hand for a card that lets
 * players put a card from hand onto the battlefield (CR 608.2d, issue #4824).
 *
 * "Each player may put a creature card from their hand onto the battlefield"
 * is worth the permanent it puts in: with a hand holding only the spell itself
 * the caster pays for a free permanent that goes to the OPPONENT alone, and
 * passing is right. The position used to hold an opaque hand, so the card read
 * `never-chosen` — a limit of the harness, not a fact about the Bot. The hand
 * learns the shape instead: one creature the position's lands could never
 * cast, so the free put is the only way it reaches the battlefield.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import { tryGetCardByName } from "../../cards/catalogue";
import type { CardDefinition } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";
import { manaValue } from "../constants";

/** Vanilla-ish creatures, ascending mana value (6, 8): the first one beyond
 *  the lands the pose gives the caster is handed over, so the free put stays
 *  the only way it reaches the battlefield whatever the spell's own cost. */
const HAND_PUT_CREATURES = ["Force of Nature", "Scaled Wurm"];

/** True when `node` holds a hand pick that a `moveZone` sends to the
 *  battlefield and whose filter admits a creature, at any depth. */
function putsCreatureFromHand(node: unknown): boolean {
    if (Array.isArray(node)) return node.some(putsCreatureFromHand);
    if (node === null || typeof node !== "object") return false;
    const rec = node as Record<string, unknown>;
    if (rec.op === "choice" && rec.kind === "choose-hand-card") {
        const filter = rec.filter as { type?: unknown } | undefined;
        const types = ([] as unknown[]).concat(filter?.type ?? []);
        if (types.includes("Creature")) return true;
    }
    return Object.values(rec).some(putsCreatureFromHand);
}

/** The creature the position hands a card whose script puts hand cards onto
 *  the battlefield, or none. Posed only for an instant or sorcery whose
 *  script both picks from hand and moves to the battlefield. */
export function handPutPose(
    def: CardDefinition,
    landCount: number
): ScenarioCard[] {
    if (!def.types.some((t) => t === "Instant" || t === "Sorcery")) return [];
    const script = JSON.stringify(def.effects ?? []);
    if (!script.includes('"to":"battlefield"')) return [];
    if (!putsCreatureFromHand(def.effects)) return [];
    const name = HAND_PUT_CREATURES.find((candidate) => {
        const creature = tryGetCardByName(candidate);
        return creature !== null && manaValue(creature.manaCost) > landCount;
    });
    return name === undefined ? [] : [{ name, owner: "me", zone: "hand" }];
}
