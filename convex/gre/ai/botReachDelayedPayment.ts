/**
 * The lands the Bot-play sweep gives the holder of a spell whose delayed
 * trigger asks the holder to pay mana later or suffer for it (CR 603.7a: a
 * delayed triggered ability created by a resolving spell; the Pact cycle —
 * "At the beginning of your next upkeep, pay {2}{G}{G}. If you don't, you lose
 * the game.").
 *
 * The generated position gives the holder lands for the card's OWN cost plus
 * two. A Pact costs nothing, so the holder held two basics of the default
 * colour and could never pay the upkeep cost: the rollouts that reach that
 * upkeep lose the game, and the search rightly passed. A player casts a Pact
 * only where the payment is in reach and leaves the turn it is made playable,
 * so the position holds the payment ON TOP of its own lands: one basic of the
 * payment's colour per mana of its mana value. The lands untap before the
 * upkeep (CR 502.3), so the payment taps the added lands and the position's
 * own stay free for what the spell found.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import { basicLandsForColors, getColorsFromCost } from "../../cards/colors";
import type { CardDefinition, ManaCost } from "../../cards/types";
import { manaValue } from "../constants";

/** The holder's `mayPay` costs inside a `delayedTrigger` body, at any depth. */
function delayedPayments(node: unknown, inDelayed: boolean): ManaCost[] {
    if (Array.isArray(node))
        return node.flatMap((child) => delayedPayments(child, inDelayed));
    if (node === null || typeof node !== "object") return [];
    const rec = node as Record<string, unknown>;
    const delayed = inDelayed || rec.op === "delayedTrigger";
    const own =
        delayed &&
        rec.op === "mayPay" &&
        rec.player === "controller" &&
        typeof rec.cost === "object" &&
        rec.cost !== null
            ? [rec.cost as ManaCost]
            : [];
    return [
        ...own,
        ...Object.values(rec).flatMap((child) =>
            delayedPayments(child, delayed)
        ),
    ];
}

/** The largest mana payment a delayed trigger of the card's spell script asks
 *  the holder for, or undefined. */
export function delayedPayment(def: CardDefinition): ManaCost | undefined {
    if (!def.types.some((t) => t === "Instant" || t === "Sorcery"))
        return undefined;
    const costs = delayedPayments(def.effects ?? [], false);
    if (costs.length === 0) return undefined;
    return costs.reduce((a, b) => (manaValue(b) > manaValue(a) ? b : a));
}

/** The basics the position adds to the holder's lands to pay the card's
 *  delayed payment: as many as its mana value, cycling its colours (a
 *  colourless payment in the card's own). Empty for a card with none. */
export function delayedPaymentLands(def: CardDefinition): string[] {
    const cost = delayedPayment(def);
    if (cost === undefined) return [];
    const colors = getColorsFromCost(cost);
    const cycle = basicLandsForColors(
        colors.length > 0 ? colors : getColorsFromCost(def.manaCost)
    );
    return Array.from(
        { length: manaValue(cost) },
        (_, i) => cycle[i % cycle.length]!
    );
}
