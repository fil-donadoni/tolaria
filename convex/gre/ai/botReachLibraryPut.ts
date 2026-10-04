/**
 * What the Bot-play sweep puts in the HOLDER's library for a spell that
 * searches it for a card and puts that card onto the battlefield (CR 701.23a,
 * issue #4832).
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
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import { handCardMatchesFilter } from "../alternativeCost";
import { tryGetCardByName } from "../../cards";
import type { CardDefinition, EffectCardFilter } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";

/** Cards a put-onto-the-battlefield search is posed against, strongest
 *  first: a large green creature, a large artifact creature. The first the
 *  search's filter matches is the one the library holds. */
const LIBRARY_CANDIDATES = ["Craw Wurm", "Juggernaut"] as const;

/** The filter of the holder's library search whose result the script moves to
 *  the battlefield, at any depth, or undefined. */
function libraryPutFilter(node: unknown): EffectCardFilter | undefined {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = libraryPutFilter(child);
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
        typeof rec.filter === "object" &&
        rec.filter !== null &&
        typeof rec.bind === "string"
    )
        return rec.filter as EffectCardFilter;
    for (const child of Object.values(rec)) {
        const found = libraryPutFilter(child);
        if (found) return found;
    }
    return undefined;
}

/** Does the script move the card bound to a search onto the battlefield? */
function putsOntoBattlefield(def: CardDefinition): boolean {
    return JSON.stringify(def.effects ?? []).includes('"to":"battlefield"');
}

/** The library card the position hands a spell that puts a searched card onto
 *  the battlefield, or none. */
export function libraryPutPose(def: CardDefinition): ScenarioCard[] {
    if (!def.types.some((t) => t === "Instant" || t === "Sorcery")) return [];
    if (!putsOntoBattlefield(def)) return [];
    const filter = libraryPutFilter(def.effects ?? []);
    if (!filter) return [];
    for (const name of LIBRARY_CANDIDATES) {
        const candidate = tryGetCardByName(name);
        if (!candidate || !handCardMatchesFilter({ card: candidate }, filter))
            continue;
        return [{ name, owner: "me", zone: "library", position: 1 }];
    }
    return [];
}
