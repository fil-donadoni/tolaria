/**
 * What the Bot-play sweep puts in the HOLDER's library for a spell that
 * searches it for a card and puts that card onto the battlefield (CR 701.23a,
 * issue #4832), into the holder's hand, or on top of the library (issue #4843).
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
 * A search that puts the card into the HAND (a tutor: "search your library for
 * a green creature card, reveal it, put it into your hand") has the same
 * limit: with a filter no basic land meets, it spends the card for nothing and
 * the hand shrinks by one. A candidate is posed that the holder's lands can
 * cast once the spell is paid for: a card found and never cast is worth less
 * to the evaluator than the mana a later payment (a Pact's upkeep cost) takes.
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
import { getColorsFromCost } from "../../cards/colors";
import type {
    CardDefinition,
    Color,
    EffectCardFilter,
} from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";
import { LAND_SUBTYPE_MANA, manaValue } from "../constants";
import { delayedPayment } from "./botReachDelayedPayment";

/** Cards a library-put search is posed against, strongest first: a large
 *  green creature, a large artifact creature. The first the search's filter
 *  matches (any, for a filterless "a card" search) is the one the library
 *  holds. */
const LIBRARY_CANDIDATES = ["Craw Wurm", "Juggernaut"] as const;

/** Cards a tutor (a search into the HAND) is posed against, strongest first:
 *  the library candidates, then smaller green and artifact creatures. A card
 *  in hand is worth what the holder does with it, so the first the filter
 *  matches AND the holder's lands can cast is the one the library holds. */
const HAND_CANDIDATES = [
    ...LIBRARY_CANDIDATES,
    "Trained Armodon",
    "Grizzly Bears",
] as const;

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
        // A search split into per-category filters is never a filterless
        // "a card" search.
        rec.categories === undefined &&
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
    to: "battlefield" | "hand" | "library-top"
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

/** Can `lands` (basic land names) cast `card` after paying `spent` mana for
 *  the spell itself (CR 601.2h, the total cost is paid): enough lands left for
 *  its mana value, and enough of each colour for its coloured symbols. */
function castableFrom(
    card: CardDefinition,
    lands: readonly string[],
    spent: number
): boolean {
    if (manaValue(card.manaCost) > lands.length - spent) return false;
    const byColor = new Map<Color, number>();
    for (const land of lands)
        for (const subtype of tryGetCardByName(land)?.subtypes ?? []) {
            const color = LAND_SUBTYPE_MANA[subtype];
            if (color) byColor.set(color, (byColor.get(color) ?? 0) + 1);
        }
    return getColorsFromCost(card.manaCost).every(
        (color) => (card.manaCost?.[color] ?? 0) <= (byColor.get(color) ?? 0)
    );
}

/** The library card the position hands a spell that puts a searched card onto
 *  the battlefield, into the hand or on top of the library, or none. `lands`
 *  are the holder's lands in the position: a card searched into the hand is
 *  posed only if they can cast it once the spell is paid for. */
export function libraryPutPose(
    def: CardDefinition,
    lands: readonly string[] = []
): ScenarioCard[] {
    if (!def.types.some((t) => t === "Instant" || t === "Sorcery")) return [];
    const search = libraryPutSearch(def.effects ?? []);
    if (!search) return [];
    const effects = def.effects ?? [];
    const toTop = putsBoundCard(effects, search.bind, "library-top");
    const toHand =
        !toTop &&
        !putsBoundCard(effects, search.bind, "battlefield") &&
        putsBoundCard(effects, search.bind, "hand");
    if (
        !toTop &&
        !toHand &&
        !putsBoundCard(effects, search.bind, "battlefield")
    )
        return [];
    const filter = search.filter;
    // What the lands have paid before the found card is cast: the spell
    // itself, or — on the turn it is made — a delayed payment, whichever is
    // larger (the lands untap in between, CR 502.3).
    const payment = delayedPayment(def);
    const spent = Math.max(
        manaValue(def.manaCost),
        payment === undefined ? 0 : manaValue(payment)
    );
    const candidates = toHand ? HAND_CANDIDATES : LIBRARY_CANDIDATES;
    for (const name of candidates) {
        const candidate = tryGetCardByName(name);
        if (
            !candidate ||
            (filter && !handCardMatchesFilter({ card: candidate }, filter)) ||
            (toHand && !castableFrom(candidate, lands, spent))
        )
            continue;
        return [
            { name, owner: "me", zone: "library", position: toTop ? 2 : 1 },
        ];
    }
    return [];
}
