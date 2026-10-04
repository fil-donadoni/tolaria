/**
 * What the Bot-play sweep holds in the OPPONENT's hand for a spell that has
 * every player shuffle their hand into their library and draw a fresh hand
 * (CR 121.1, CR 701.24a, issue #4833).
 *
 * "Each player shuffles their hand and graveyard into their library, then
 * draws seven cards" refills BOTH hands, so on a position where the opponent
 * holds nothing it hands the opponent seven cards for the seven the caster
 * gets and the caster pays six mana for a symmetric trade: passing is right.
 * The position used to hold that opponent hand empty, so these spells read
 * `never-chosen` — a limit of the harness, not a fact about the Bot. The
 * opponent learns the shape instead: a hand already as full as the refill
 * makes it, so the refill is one-sided and casting is an outcome the caster
 * can want.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import type { CardDefinition } from "../../cards/types";

/** The cards the refill deals each player (the biggest shipped one). */
const REFILL_SIZE = 7;

/** Does a `forEach` over every player move that player's hand into their
 *  library and draw them cards, at any depth of the script? */
function refillsEveryHand(node: unknown): boolean {
    if (Array.isArray(node)) return node.some(refillsEveryHand);
    if (node === null || typeof node !== "object") return false;
    const rec = node as Record<string, unknown>;
    if (
        rec.op === "forEach" &&
        (rec.select as { set?: unknown } | undefined)?.set === "players"
    ) {
        const body = JSON.stringify(rec.effects ?? []);
        if (
            body.includes('"op":"moveZone"') &&
            body.includes('"from":"hand"') &&
            body.includes('"to":"library"') &&
            body.includes('"op":"draw"')
        )
            return true;
    }
    return Object.values(rec).some(refillsEveryHand);
}

/** How many cards the opponent's hand holds for a spell that refills every
 *  hand, or undefined when the card refills none. */
export function handRefillOpponentHand(
    def: CardDefinition
): number | undefined {
    if (!def.types.some((t) => t === "Instant" || t === "Sorcery"))
        return undefined;
    return refillsEveryHand(def.effects ?? []) ? REFILL_SIZE : undefined;
}
