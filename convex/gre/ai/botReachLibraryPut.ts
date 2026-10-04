/**
 * What the Bot-play sweep puts in the HOLDER's library for a spell that
 * searches it for a card and puts that card onto the battlefield (CR 701.23a,
 * issue #4832) or on top of the library (issue #4843).
 *
 * "Search your library for a green creature card, put it onto the battlefield"
 * finds nothing when the library holds no such card, so on the position's
 * filler library (basic lands) the spell pays its mana and its additional cost
 * for an empty search and passing is right. The position used to hold no card
 * the search could take, so these spells read `never-chosen` — a limit of the
 * harness, not a fact about the Bot. The library learns the shape instead: one
 * card the search's filter matches, larger than the fillers the holder
 * controls, so the swap is a trade the caster can want.
 *
 * A search that puts the card on TOP of the library ("search for a card, then
 * shuffle and put that card on top") has the same limit: on a library of
 * basic lands the card it finds is a land and the next draw (CR 504.1) is a
 * land either way, so the spell costs its mana and life for nothing. The card
 * is posed one place BELOW the top, so putting it there changes the draw.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import { handCardMatchesFilter } from "../alternativeCost";
import { tryGetCardByName } from "../../cards";
import type { CardDefinition, EffectCardFilter } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";

/** Cards a library-put search is posed against, strongest first: a large
 *  green creature, a large artifact creature. The first the search's filter
 *  matches (any, for a filterless "a card" search) is the one the library
 *  holds. */
const LIBRARY_CANDIDATES = ["Craw Wurm", "Juggernaut"] as const;

/** The holder's library search (its filter and the binding its result lands
 *  in), at any depth, or undefined. */
function libraryPutSearch(
    node: unknown
): { filter: EffectCardFilter | undefined; bind: string } | undefined {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = libraryPutSearch(child);
            if (found) return found;
        }
        return undefined;
    }
    if (node === null || typeof node !== "object") return undefined;
    const rec = node as Record<string, unknown>;
    if (
        rec.op === "choice" &&
        rec.kind === "search-library" &&
        rec.player === "controller" &&
        rec.zone === "library" &&
        (rec.filter === undefined ||
            (typeof rec.filter === "object" && rec.filter !== null)) &&
        typeof rec.bind === "string"
    )
        return {
            filter: rec.filter as EffectCardFilter | undefined,
            bind: rec.bind,
        };
    for (const child of Object.values(rec)) {
        const found = libraryPutSearch(child);
        if (found) return found;
    }
    return undefined;
}

/** Does the script move the card bound to `bind` to `to`? */
function putsBoundCard(
    node: unknown,
    bind: string,
    to: "battlefield" | "library-top"
): boolean {
    if (Array.isArray(node))
        return node.some((n) => putsBoundCard(n, bind, to));
    if (node === null || typeof node !== "object") return false;
    const rec = node as Record<string, unknown>;
    const cards = rec.cards as { ref?: unknown } | undefined;
    if (rec.op === "moveZone" && rec.to === to && cards?.ref === bind)
        return true;
    return Object.values(rec).some((child) => putsBoundCard(child, bind, to));
}

/** The library card the position hands a spell that puts a searched card onto
 *  the battlefield or on top of the library, or none. */
export function libraryPutPose(def: CardDefinition): ScenarioCard[] {
    if (!def.types.some((t) => t === "Instant" || t === "Sorcery")) return [];
    const search = libraryPutSearch(def.effects ?? []);
    if (!search) return [];
    const toTop = putsBoundCard(def.effects ?? [], search.bind, "library-top");
    if (!toTop && !putsBoundCard(def.effects ?? [], search.bind, "battlefield"))
        return [];
    const filter = search.filter;
    for (const name of LIBRARY_CANDIDATES) {
        const candidate = tryGetCardByName(name);
        if (
            !candidate ||
            (filter && !handCardMatchesFilter({ card: candidate }, filter))
        )
            continue;
        return [
            { name, owner: "me", zone: "library", position: toTop ? 2 : 1 },
        ];
    }
    return [];
}
