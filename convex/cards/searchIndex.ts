// The deck-builder search index — DERIVED, never transported (issue #3054,
// ADR 0113 §4).
//
// This used to be `api.cardIndex.list`, a Convex query that mapped
// `getAllCards()` into rows and shipped them over the wire: measured at 2,051
// rows / 1,605,676 B raw / 248,393 B gzip, the largest read in the app, paid
// on every cold load, per user. Every byte of it is a function of definitions
// the client ALREADY holds, so the read bought nothing.
//
// WHY DERIVED AND NOT AN ASSET. ADR 0113 §3's consequence — "the hot/cold
// split dissolves client-side" — is what makes this possible: since issue
// #3053 the client's registry is FULLY hydrated before any consumer renders
// (hand-written definitions from the module graph, compiled ones from the
// fetched catalogue artifact), so the index is a pure `map` over data that is
// already resident. Measured on the merged population: 4,337 rows in 57 ms
// (6 ms to enumerate + expand, 51 ms to build), against 343 KB gzip to ship
// the same rows as a second content-addressed asset — more bytes than the
// Convex query it would have replaced, plus a committed file and a freshness
// gate to keep in sync. Nothing to transport is strictly better than
// something cheap to transport.
//
// WHY THIS FIXES `available`. The old query read `getAllCards()`, which is
// the HAND-WRITTEN population only (`compiledCatalogue.ts` documents that
// exclusion). `src/lib/fullCatalogue.ts` derived a card's availability from
// membership in it, so every compiled card read as *Unavailable* in the deck
// builder however well the engine could play it. The registry does not make
// that distinction — `getDefinition` never tells the two apart (PRD #2693) —
// so deriving from the registry is what makes availability mean "the engine
// has this card".
//
// WHEN IT IS SAFE TO CALL. After the registry is hydrated, which
// `src/components/ui/catalogue-gate.tsx` makes structural: it sits above the
// whole route tree and its children do not exist as elements until
// `hydrateCatalogue()` has resolved. On the SERVER hydration is a module-load
// side effect. There is no third case.
import { getCardColorIdentity } from "./colors";
import { aggregateOracleText } from "./oracleAggregator";
import { getPrintingsForCard, type CardPrinting } from "./catalogue";
import { FACE_DOWN_CARD_ID, registeredDefinitions } from "./registry";
import { foldAccents } from "./textNormalize";
import type { CardDefinition } from "./types";
import { manaValue } from "../gre/constants";

/** One searchable card in the deck builder's pool. */
export interface SearchIndexRow {
    cardId: string;
    name: string;
    nameLower: string;
    /** `nameLower` with diacritics stripped (CR-irrelevant; search aid). */
    nameFold: string;
    types: string[];
    subtypes: string[];
    supertypes: string[];
    colors: string[];
    manaValue: number;
    oracleText: string;
    /** `oracleText` with diacritics stripped. */
    oracleFold: string;
    /** All printings (original first). `cardId === prints[0].printId`. Drives
     *  the set filter and the per-card edition picker.
     *
     *  A COMPILED card has no `CardPrint` in the module graph, so it carries
     *  exactly one printing with an EMPTY `setCode` — the set a compiled row
     *  was printed in lives on `data/card-index.json`, which is a server-side
     *  input and reaches no client. Consequence, stated rather than hidden:
     *  a compiled card is not reachable through the Set filter. Nothing
     *  regresses — `set-filter.tsx` builds its options from
     *  `getAllSetCodes()`, the hand-written population, so no selectable set
     *  ever named a compiled card either. */
    prints: CardPrinting[];
}

/** Project ONE definition into its index row. Pure; the definition must
 *  already be expanded (ADR 0054) — {@link buildSearchIndex} routes every row
 *  through `registeredDefinitions`, which expands. */
export function toSearchIndexRow(def: CardDefinition): SearchIndexRow {
    const nameLower = def.name.toLowerCase();
    const oracleText = aggregateOracleText(def).searchable;
    return {
        cardId: def.id,
        name: def.name,
        nameLower,
        nameFold: foldAccents(nameLower),
        types: [...def.types] as string[],
        subtypes: [...(def.subtypes ?? [])],
        supertypes: [...(def.supertypes ?? [])] as string[],
        colors: getCardColorIdentity(def) as string[],
        manaValue: manaValue(def.manaCost),
        oracleText,
        oracleFold: foldAccents(oracleText),
        prints: getPrintingsForCard(def.id),
    };
}

/**
 * The whole index, in registry hydration order.
 *
 * The population is every definition the runtime registry holds — hand-written
 * and compiled alike — minus the face-down sentinel, which is a rules object
 * (CR 708.2) and not a printed card: `registry.ts` registers it in the lookup
 * map on purpose and keeps it out of every set export for exactly this reason.
 */
export function buildSearchIndex(): SearchIndexRow[] {
    const rows: SearchIndexRow[] = [];
    for (const def of registeredDefinitions()) {
        if (def.id === FACE_DOWN_CARD_ID) continue;
        rows.push(toSearchIndexRow(def));
    }
    return rows;
}
