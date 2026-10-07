// The deck-builder search index — derived from the definitions, never
// transported per user (issue #3054, ADR 0113 §4), and since issue #4861
// derived AHEAD OF TIME (ADR 0113 Amendment IV).
//
// This used to be `api.cardIndex.list`, a Convex query that mapped
// `getAllCards()` into rows and shipped them over the wire: measured at 2,051
// rows / 1,605,676 B raw / 248,393 B gzip, the largest read in the app, paid
// on every cold load, per user. Issue #3054 replaced it with a derivation in
// the browser, which was free while the client hydrated the whole corpus
// anyway (ADR 0113 § 3).
//
// WHY A GENERATED ASSET NOW. The client no longer hydrates the corpus: it
// decodes a definition on first request (issue #4861), so deriving the index
// in the browser would decode every block — the whole catalogue made resident
// to search it. The rows are instead written by `bun run catalogue:pack`
// into `data/catalogue/search-index.json`, with THIS module's
// `toSearchIndexRow` run over the rows that generation writes
// (`scripts/lib/search-index.ts`), and the deck builder loads that file
// lazily (`src/lib/searchIndex.ts`): only the cards it shows are ever decoded.
// The freshness gate (`scripts/__tests__/catalogue-artifact.test.ts`) reds a
// committed index that is not what the tree derives AND one that differs from
// `buildSearchIndex` over the live catalogue — the same derivation twice.
//
// WHY `available` MEANS "THE ENGINE HAS THIS CARD". The old query read
// `getAllCards()`, which is the HAND-WRITTEN population only, so every
// compiled card read as *Unavailable* in the deck builder however well the
// engine could play it. `getAllCatalogueCards()` is both populations — the
// distinction was never one the engine drew (`getDefinition` has never told
// the two apart, PRD #2693); only this index did.
import { getCardColorIdentity } from "./colors";
import { aggregateOracleText } from "./oracleAggregator";
import {
    getAllCatalogueCards,
    getDefinitionSetCode,
    type CardPrinting,
} from "./catalogue";
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
    types: readonly string[];
    subtypes: readonly string[];
    supertypes: readonly string[];
    colors: readonly string[];
    manaValue: number;
    oracleText: string;
    /** `oracleText` with diacritics stripped. */
    oracleFold: string;
    /** The card's own first-printing Set (`CardDefinition.setCode` for a
     *  compiled card, issue #4363). The index carries NO printing list (Card
     *  Prints, ADR 0140, issue #4118): every printing lives in the
     *  `cardPrints` table and is queried by Card ID when the edition
     *  selector opens. */
    setCode: string;
    /** The one home printing, `{ cardId, setCode }` — derived, never shipped:
     *  the deck builder's entry shape (`CardIndexEntry`) carries it, and a
     *  row that already IS that shape is the one object per card the deck
     *  builder holds (issue #5125). */
    prints: readonly CardPrinting[];
}

/** Project ONE definition into its index row. Pure; the definition must
 *  already be expanded (ADR 0054) — {@link buildSearchIndex} routes every row
 *  through `getAllCatalogueCards`, which expands. `setCode` is the card's own
 *  Set, the catalogue's unless the caller holds a fresher one (the generator,
 *  which derives the rows it is about to write). */
export function toSearchIndexRow(
    def: CardDefinition,
    setCode: string = getDefinitionSetCode(def.id)
): SearchIndexRow {
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
        setCode,
        prints: [{ printId: def.id, setCode }],
    };
}

/**
 * The whole index, in catalogue order.
 *
 * The population is `getAllCatalogueCards()` — hand-written plus compiled, and
 * NOTHING else. Enumerating the runtime registry instead would be wrong in a
 * way no type catches: that map also holds the face-down sentinel (CR 708.2)
 * and every token definition an engine run synthesized (CR 111.1), so the deck
 * builder would offer a `token:…` id as an addable card, and only after the
 * user happened to visit a board first. See `catalogue.ts`'s
 * `compiledIds` for the whole argument.
 */
export function buildSearchIndex(): SearchIndexRow[] {
    return getAllCatalogueCards().map((def) => toSearchIndexRow(def));
}

/** One row as the committed asset carries it: the fields the generator
 *  derives, in this order. The lowercased and accent-folded forms are NOT
 *  shipped — {@link fromSearchIndexWire} recomputes them, so the asset
 *  carries each text once. */
export type SearchIndexWireRow = readonly [
    cardId: string,
    name: string,
    types: readonly string[],
    subtypes: readonly string[],
    supertypes: readonly string[],
    colors: readonly string[],
    manaValue: number,
    oracleText: string,
    setCode: string,
];

/** The committed bytes: one minified line, rows in catalogue order. */
export function serializeSearchIndex(rows: readonly SearchIndexRow[]): string {
    const wire: SearchIndexWireRow[] = rows.map((r) => [
        r.cardId,
        r.name,
        r.types,
        r.subtypes,
        r.supertypes,
        r.colors,
        r.manaValue,
        r.oracleText,
        r.setCode,
    ]);
    return JSON.stringify(wire) + "\n";
}

/** The rows back from the asset — exactly what {@link buildSearchIndex}
 *  returned when the generator ran.
 *
 *  WHY THE ARRAYS ARE SHARED (issue #5125). This is the deck builder's whole
 *  resident index, and at 35,000 cards a fresh `types` / `subtypes` /
 *  `supertypes` / `colors` array per row was a third of it — while the
 *  committed rows hold under a thousand DISTINCT such arrays (`["Creature"]`,
 *  `[]`, `["U"]`…). Each distinct one is built once, frozen, and shared by
 *  every row carrying it; frozen because a consumer mutating one would edit
 *  every row that shares it, and `readonly` already says nobody may.
 *  Measured by `bun run measure:client-heap` (the `deck-builder` lines). */
export function fromSearchIndexWire(
    wire: readonly SearchIndexWireRow[]
): SearchIndexRow[] {
    const shared = new Map<string, readonly string[]>();
    const intern = (values: readonly string[]): readonly string[] => {
        const key = values.join("\u0000");
        let hit = shared.get(key);
        if (hit === undefined) {
            hit = Object.freeze([...values]);
            shared.set(key, hit);
        }
        return hit;
    };
    return wire.map(
        ([
            cardId,
            name,
            types,
            subtypes,
            supertypes,
            colors,
            manaValue,
            oracleText,
            setCode,
        ]) => {
            const nameLower = name.toLowerCase();
            return {
                cardId,
                name,
                nameLower,
                nameFold: foldAccents(nameLower),
                types: intern(types),
                subtypes: intern(subtypes),
                supertypes: intern(supertypes),
                colors: intern(colors),
                manaValue,
                oracleText,
                oracleFold: foldAccents(oracleText),
                setCode,
                prints: [{ printId: cardId, setCode }],
            };
        }
    );
}
