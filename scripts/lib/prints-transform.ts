// The pure sync transform (ADR 0140, issue #4116): Scryfall `default_cards`
// rows + the card-index oracle-id map + the rarity override file → the rows
// `convex/cardPrints.ts:upsertBatch` writes. No I/O, no Convex — every rule
// here is a fixture-driven unit test in `scripts/__tests__/prints-transform.test.ts`.

import type { Rarity } from "../../convex/cards/types";
import { resolveRarity, type RarityOverridesFile } from "./prints-rarity";

/** The fields this transform reads off one Scryfall `default_cards` row. */
export interface ScryfallDefaultCardRow {
    id: string;
    oracle_id?: string;
    set: string;
    rarity: string;
    digital?: boolean;
    promo?: boolean;
    oversized?: boolean;
    all_parts?: readonly {
        id: string;
        name: string;
        component: string;
    }[];
}

/** The one field pair this transform needs from `data/card-index.json`. */
export interface CardIndexRow {
    oracleId: string;
    scryfallId: string;
}

export interface TokenPrintRow {
    name: string;
    tokenPrintId: string;
}

export interface CardPrintRow {
    printId: string;
    cardId: string;
    set: string;
    rarity: Rarity;
    digital: boolean;
    promo: boolean;
    tokenPrints: TokenPrintRow[];
}

/**
 * `oracle_id -> Card ID` for every implemented card. Twin ids (registered
 * split/room/adventure/flip halves — `${parent}#left` etc, ADR 0123) are
 * never real Scryfall UUIDs and never enter the sync as input (ADR 0140 §2):
 * a card-index row whose `scryfallId` carries one is dropped here, before any
 * Scryfall row is looked up against it.
 */
export function buildDefinitionIndex(
    rows: readonly CardIndexRow[]
): Map<string, string> {
    const byOracleId = new Map<string, string>();
    for (const row of rows) {
        if (row.scryfallId.includes("#")) continue;
        byOracleId.set(row.oracleId, row.scryfallId);
    }
    return byOracleId;
}

/**
 * One Scryfall `default_cards` row -> zero or one `CardPrintRow`.
 *
 * Exclusions (ADR 0140 §2): oversized cards; a row with no oracle id, or one
 * not naming an implemented Card Definition; the printing whose id IS the
 * Card ID (that is the definition itself, never a Card Print of it).
 *
 * Token Prints come straight from THIS row's `all_parts` `"token"` entries —
 * Scryfall already resolves the same-edition-else-paired fallback per
 * printing (PRD #4115 Further Notes), so there is no second fallback to
 * compute here.
 */
export function buildCardPrintRow(
    row: ScryfallDefaultCardRow,
    definitionByOracleId: ReadonlyMap<string, string>,
    overrides: RarityOverridesFile
): CardPrintRow | null {
    if (row.oversized) return null;
    if (!row.oracle_id) return null;
    const cardId = definitionByOracleId.get(row.oracle_id);
    if (!cardId) return null;
    if (row.id === cardId) return null;

    const tokenPrints: TokenPrintRow[] = (row.all_parts ?? [])
        .filter((part) => part.component === "token")
        .map((part) => ({ name: part.name, tokenPrintId: part.id }));

    return {
        printId: row.id,
        cardId,
        set: row.set,
        rarity: resolveRarity(row.id, row.rarity, overrides),
        digital: Boolean(row.digital),
        promo: Boolean(row.promo),
        tokenPrints,
    };
}

export function buildCardPrintRows(
    scryfallRows: readonly ScryfallDefaultCardRow[],
    definitionByOracleId: ReadonlyMap<string, string>,
    overrides: RarityOverridesFile
): CardPrintRow[] {
    const out: CardPrintRow[] = [];
    for (const row of scryfallRows) {
        const built = buildCardPrintRow(row, definitionByOracleId, overrides);
        if (built) out.push(built);
    }
    return out;
}

export interface PrintRowsSummary {
    rowCount: number;
    tokenLinkCount: number;
    totalBytes: number;
}

/** `--dry-run`'s report (row count, token-link count, total bytes) — no
 *  write, so this is the whole effect of that mode. */
export function summarizePrintRows(
    rows: readonly CardPrintRow[]
): PrintRowsSummary {
    let tokenLinkCount = 0;
    let totalBytes = 0;
    for (const row of rows) {
        tokenLinkCount += row.tokenPrints.length;
        totalBytes += Buffer.byteLength(JSON.stringify(row), "utf8");
    }
    return { rowCount: rows.length, tokenLinkCount, totalBytes };
}
