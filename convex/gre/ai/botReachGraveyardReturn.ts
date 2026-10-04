/**
 * What the Bot-play sweep puts in the HOLDER's graveyard for a spell that
 * returns every card of a type from it to the battlefield (CR 404.1,
 * CR 400.7, issue #4830).
 *
 * "Return all enchantment cards from your graveyard to the battlefield" does
 * nothing when the graveyard holds none, so on the position's filler graveyard
 * (a creature) the card pays its mana to change nothing and passing is right.
 * The position used to hold no such card, so the spell read `never-chosen` — a
 * limit of the harness, not a fact about the Bot. The graveyard learns the
 * shape instead: a few cards of the returned type, so the spell brings
 * permanents back and casting is an outcome the caster can want.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import type { CardDefinition } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";

/** Cards of the returned type the graveyard holds. */
const RETURNED_COPIES = 3;

/** A graveyard card per returned type: a global enchantment (+0/+2 to its
 *  controller's untapped creatures), an artifact creature, a creature. */
const GRAVEYARD_CARD_BY_TYPE: Readonly<Record<string, string>> = {
    Enchantment: "Castle",
    Artifact: "Ornithopter",
    Creature: "Grizzly Bears",
};

/** The type a `forEach` over the holder's own graveyard returns to the
 *  battlefield with a `moveZone`, at any depth of the script. */
function returnedType(node: unknown): string | undefined {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = returnedType(child);
            if (found) return found;
        }
        return undefined;
    }
    if (node === null || typeof node !== "object") return undefined;
    const rec = node as Record<string, unknown>;
    if (rec.op === "forEach") {
        const select = rec.select as
            | {
                  set?: unknown;
                  controller?: unknown;
                  filter?: { type?: unknown };
              }
            | undefined;
        const type = select?.filter?.type;
        if (
            select?.set === "graveyard" &&
            select.controller === "controller" &&
            typeof type === "string" &&
            type in GRAVEYARD_CARD_BY_TYPE &&
            JSON.stringify(rec.effects ?? []).includes('"to":"battlefield"')
        )
            return type;
    }
    for (const child of Object.values(rec)) {
        const found = returnedType(child);
        if (found) return found;
    }
    return undefined;
}

/** The graveyard cards the position hands a spell that returns a type of card
 *  from the holder's graveyard to the battlefield, or none. */
export function graveyardReturnPose(def: CardDefinition): ScenarioCard[] {
    if (!def.types.some((t) => t === "Instant" || t === "Sorcery")) return [];
    const type = returnedType(def.effects ?? []);
    if (!type) return [];
    return [
        {
            name: GRAVEYARD_CARD_BY_TYPE[type]!,
            owner: "me",
            zone: "graveyard",
            count: RETURNED_COPIES,
        },
    ];
}
