import { tryGetDefinition } from "@convex/cards";
import { resolveCardImageId } from "~/lib/images";

/** One `cardPrints` row as the Game-load query ships it
 *  (`api.cardPrints.tokenPrintsForGame`, ADR 0140 §4, issue #4120): the
 *  printing, the Card ID it prints, and the tokens that printing is paired
 *  with. */
export interface TokenPrintRow {
    printId: string;
    cardId: string;
    tokenPrints: readonly { name: string; tokenPrintId: string }[];
}

/** Rows keyed by `printId` — the shape the resolver chain reads. */
export type TokenPrintIndex = ReadonlyMap<string, TokenPrintRow>;

export const EMPTY_TOKEN_PRINT_INDEX: TokenPrintIndex = new Map();

export function indexTokenPrintRows(
    rows: readonly TokenPrintRow[]
): TokenPrintIndex {
    return new Map(rows.map((row) => [row.printId, row]));
}

function tokenPrintNamed(
    row: TokenPrintRow | undefined,
    tokenName: string
): string | undefined {
    const wanted = tokenName.toLowerCase();
    return row?.tokenPrints.find((t) => t.name.toLowerCase() === wanted)
        ?.tokenPrintId;
}

/** The Token Print for a token named `tokenName` made from `sourcePrintId`
 *  (ADR 0140 §4, issue #4120), or `undefined`.
 *
 *  Link 2 is the Token Print with the token's name on the `sourcePrintId` row —
 *  the edition that created it: an Odyssey printing makes an Odyssey-style
 *  token. Link 3 is the DEFINITION printing's (the row whose `printId` is the
 *  source row's `cardId`): Scryfall's own pairing, the fallback when that
 *  edition printed none. A pure lookup — the engine stamped `sourcePrintId`
 *  and never reads it. */
export function resolveTokenPrintId(
    sourcePrintId: string | undefined,
    tokenName: string,
    index: TokenPrintIndex
): string | undefined {
    if (!sourcePrintId) return undefined;
    const sourceRow = index.get(sourcePrintId);
    return (
        tokenPrintNamed(sourceRow, tokenName) ??
        (sourceRow && sourceRow.cardId !== sourceRow.printId
            ? tokenPrintNamed(index.get(sourceRow.cardId), tokenName)
            : undefined)
    );
}

/** What a token (or a designation tile) needs to name its art. */
interface TokenArtSource {
    imagePrintId?: string;
    sourcePrintId?: string;
}

/** The whole client resolver chain for a card-shaped object (issue #4120):
 *
 *  1. an explicit `imagePrintId` — the instance's own pin (an Eternalize
 *     token's frame, a chosen printing) or the token definition's (Treasure /
 *     Clue / Map), unchanged;
 *  2. the Token Print with the token's name on the `sourcePrintId` row;
 *  3. the definition printing's Token Print;
 *  4. `null` — the caller renders its placeholder.
 *
 *  Never throws and never reaches Scryfall: an object with no `sourcePrintId`
 *  (every non-token) stops at link 1, exactly as before. */
export function resolveArtPrintId(
    defId: string,
    instance: TokenArtSource | undefined,
    index: TokenPrintIndex
): string | null {
    const explicit = instance?.imagePrintId ?? resolveCardImageId(defId);
    if (explicit) return explicit;
    if (!instance?.sourcePrintId) return null;
    const name = tryGetDefinition(defId)?.name;
    if (!name) return null;
    return resolveTokenPrintId(instance.sourcePrintId, name, index) ?? null;
}
