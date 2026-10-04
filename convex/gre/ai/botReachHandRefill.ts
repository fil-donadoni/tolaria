/**
 * Does a spell have every player shuffle their hand into their library and
 * draw a fresh hand (CR 121.1, CR 701.24a, issue #4833)?
 *
 * "Each player shuffles their hand and graveyard into their library, then
 * draws seven cards" (or discards their hand, CR 701.9a, issue #4844) is a
 * draw worth the cards it finds, and the position's filler library is basic
 * lands the evaluator prices at nothing: the caster trades the card it holds (priced as seven draws) for seven lands and passing
 * is right. The spell read `never-chosen` — a limit of the harness, not a fact
 * about the Bot. `drawsForController` misses it, since each draw names the
 * iterating player (`$each`), not the controller; this predicate gives the
 * pose the same sweetening, a library holding spells.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import type { CardDefinition } from "../../cards/types";

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
        const movesHandAway =
            (body.includes('"op":"moveZone"') &&
                body.includes('"from":"hand"') &&
                body.includes('"to":"library"')) ||
            // CR 701.9a: a whole-hand discard (`cards` omitted) empties the
            // hand the same way, into the graveyard instead (issue #4844).
            (body.includes('"op":"discard"') && !body.includes('"cards"'));
        if (movesHandAway && body.includes('"op":"draw"')) return true;
    }
    return Object.values(rec).some(refillsEveryHand);
}

/** Does the spell refill every player's hand from their library? */
export function handRefillSpell(def: CardDefinition): boolean {
    return (
        def.types.some((t) => t === "Instant" || t === "Sorcery") &&
        refillsEveryHand(def.effects ?? [])
    );
}
