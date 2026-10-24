/**
 * What the Bot-play sweep puts OUTSIDE THE GAME for a card that brings a card
 * in from there (CR 400.11b — the Wish cards: "You may reveal a sorcery card
 * you own from outside the game and put it into your hand").
 *
 * A generated position has no sideboard, so the wish finds nothing and the
 * spell pays its mana to exile itself: passing is right, and the card read
 * `never-chosen` — a limit of the harness, not a fact about the Bot. The
 * holder's sideboard (CR 400.11a) learns the shape instead: one card the
 * wish's filter matches, worth more in hand than the wish itself.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import { handCardMatchesFilter } from "../alternativeCost";
import { tryGetCardByName } from "../../cards";
import type { CardDefinition, EffectCardFilter } from "../../cards/types";

/** Cards a wish is posed against, strongest first; the first its filter
 *  matches (any, for a filterless wish) is the one the sideboard holds. */
const OUTSIDE_GAME_CANDIDATES = ["Mind Twist", "Craw Wurm"] as const;

/** The filter of the controller's `bringFromOutsideGame` Op at any depth —
 *  `null` for a filterless one, `undefined` when the script has none. */
function outsideGameFilter(node: unknown): EffectCardFilter | null | undefined {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = outsideGameFilter(child);
            if (found !== undefined) return found;
        }
        return undefined;
    }
    if (node === null || typeof node !== "object") return undefined;
    const rec = node as Record<string, unknown>;
    if (rec.op === "bringFromOutsideGame" && rec.player === "controller")
        return (rec.filter as EffectCardFilter | undefined) ?? null;
    for (const child of Object.values(rec)) {
        const found = outsideGameFilter(child);
        if (found !== undefined) return found;
    }
    return undefined;
}

/** The card the position puts in the holder's sideboard for a card whose
 *  script brings one in from outside the game, or none. */
export function outsideGamePose(
    def: CardDefinition
): { name: string; owner: "me" }[] {
    const filter = outsideGameFilter(def.effects ?? []);
    if (filter === undefined) return [];
    for (const name of OUTSIDE_GAME_CANDIDATES) {
        const candidate = tryGetCardByName(name);
        if (
            !candidate ||
            (filter && !handCardMatchesFilter({ card: candidate }, filter))
        )
            continue;
        return [{ name, owner: "me" }];
    }
    return [];
}
