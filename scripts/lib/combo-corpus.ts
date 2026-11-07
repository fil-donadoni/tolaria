/**
 * The Combo Corpus projection (ADR 0164 § 1, issue #8416): the Commander
 * Spellbook bulk export, reduced to the combos whose pieces are all cards the
 * engine has. Pure — the download and the file writes live in
 * `scripts/combos-import.ts`, so a fixture can exercise every rule offline.
 *
 * The drop reasons are checked in a fixed order, so each dropped variant is
 * counted once and the counts sum to `upstream`: status, then catalogue
 * membership, then template, then piece count. Catalogue first because almost
 * everything upstream falls there; "dropped by template" then reads as "would
 * have been ours", the number worth reviewing.
 */

/** Above this many pieces a combo is out of the corpus (ADR 0164 § 1). */
export const MAX_COMBO_PIECES = 4;

export const SPELLBOOK_SITE = "https://commanderspellbook.com";
export const SPELLBOOK_EXPORT_URL =
    "https://json.commanderspellbook.com/variants.json";

// ── Upstream shape: only the fields the projection reads ────────────────────

export interface SpellbookUse {
    readonly card: {
        readonly name: string;
        readonly oracleId: string | null;
    };
    readonly zoneLocations: readonly string[];
    readonly battlefieldCardState: string;
    readonly exileCardState: string;
    readonly libraryCardState: string;
    readonly graveyardCardState: string;
    readonly mustBeCommander: boolean;
    readonly quantity: number;
    readonly usedFace: number | null;
}

export interface SpellbookVariant {
    readonly id: string;
    readonly status: string;
    readonly uses: readonly SpellbookUse[];
    /** Template pieces ("a creature with haste"): their mere presence drops. */
    readonly requires: readonly unknown[];
    readonly produces: readonly {
        readonly feature: { readonly name: string };
    }[];
    readonly identity: string;
    readonly manaNeeded: string;
    readonly manaValueNeeded: number | null;
    readonly easyPrerequisites: string;
    readonly notablePrerequisites: string;
    readonly description: string;
    readonly popularity: number | null;
}

export interface SpellbookExport {
    readonly timestamp: string;
    readonly version: string;
    readonly variants: readonly SpellbookVariant[];
}

// ── The vendored shape ──────────────────────────────────────────────────────

/** What must be true of a piece beyond its zone; absent keys require nothing. */
export interface ComboPieceState {
    readonly battlefield?: string;
    readonly exile?: string;
    readonly library?: string;
    readonly graveyard?: string;
    readonly mustBeCommander?: true;
    /** 1-based face of a two-faced card, when the combo needs a specific one. */
    readonly usedFace?: number;
}

export interface ComboPiece {
    readonly name: string;
    readonly oracleId: string;
    /** Spellbook zone letters, any one of which satisfies the piece. */
    readonly zones: readonly string[];
    readonly quantity: number;
    readonly state?: ComboPieceState;
}

export interface ComboCorpusEntry {
    readonly id: string;
    readonly pieces: readonly ComboPiece[];
    /** Spellbook feature names, raw: a Bot seam classifies them, not the import. */
    readonly produces: readonly string[];
    readonly manaNeeded: string;
    readonly manaValueNeeded: number | null;
    readonly identity: string;
    readonly popularity: number | null;
    readonly easyPrerequisites: string;
    readonly notablePrerequisites: string;
    readonly description: string;
}

export interface ComboCorpusCounts {
    readonly upstream: number;
    readonly kept: number;
    readonly droppedByStatus: number;
    readonly droppedByCatalogue: number;
    readonly droppedByTemplate: number;
    readonly droppedByPieceCount: number;
}

export interface ComboCorpusProjection {
    readonly combos: readonly ComboCorpusEntry[];
    readonly counts: ComboCorpusCounts;
}

export interface ComboCorpusSource {
    readonly name: string;
    readonly site: string;
    readonly export: string;
    readonly exportTimestamp: string;
    readonly exportVersion: string;
}

function projectState(use: SpellbookUse): ComboPieceState | null {
    const state: {
        -readonly [K in keyof ComboPieceState]: ComboPieceState[K];
    } = {};
    if (use.battlefieldCardState) state.battlefield = use.battlefieldCardState;
    if (use.exileCardState) state.exile = use.exileCardState;
    if (use.libraryCardState) state.library = use.libraryCardState;
    if (use.graveyardCardState) state.graveyard = use.graveyardCardState;
    if (use.mustBeCommander) state.mustBeCommander = true;
    if (use.usedFace !== null) state.usedFace = use.usedFace;
    return Object.keys(state).length > 0 ? state : null;
}

function projectPiece(use: SpellbookUse, oracleId: string): ComboPiece {
    const state = projectState(use);
    return {
        name: use.card.name,
        oracleId,
        zones: use.zoneLocations,
        quantity: use.quantity,
        ...(state ? { state } : {}),
    };
}

function projectEntry(variant: SpellbookVariant): ComboCorpusEntry {
    return {
        id: variant.id,
        pieces: variant.uses.map((use) =>
            // Membership already passed, so the id is a string here.
            projectPiece(use, use.card.oracleId as string)
        ),
        produces: variant.produces.map((p) => p.feature.name),
        manaNeeded: variant.manaNeeded,
        manaValueNeeded: variant.manaValueNeeded,
        identity: variant.identity,
        popularity: variant.popularity,
        easyPrerequisites: variant.easyPrerequisites,
        notablePrerequisites: variant.notablePrerequisites,
        description: variant.description,
    };
}

function pieceCount(variant: SpellbookVariant): number {
    return variant.uses.reduce((sum, use) => sum + use.quantity, 0);
}

export function projectComboCorpus(
    variants: readonly SpellbookVariant[],
    catalogueOracleIds: ReadonlySet<string>
): ComboCorpusProjection {
    let droppedByStatus = 0;
    let droppedByCatalogue = 0;
    let droppedByTemplate = 0;
    let droppedByPieceCount = 0;
    const combos: ComboCorpusEntry[] = [];
    for (const variant of variants) {
        if (variant.status !== "OK") droppedByStatus++;
        else if (
            !variant.uses.every(
                (use) =>
                    use.card.oracleId !== null &&
                    catalogueOracleIds.has(use.card.oracleId)
            )
        )
            droppedByCatalogue++;
        else if (variant.requires.length > 0) droppedByTemplate++;
        else if (pieceCount(variant) > MAX_COMBO_PIECES) droppedByPieceCount++;
        else combos.push(projectEntry(variant));
    }
    // Code-unit order, never `localeCompare`: the bytes must not depend on the
    // machine's locale, or a re-import is not a reviewable diff.
    combos.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {
        combos,
        counts: {
            upstream: variants.length,
            kept: combos.length,
            droppedByStatus,
            droppedByCatalogue,
            droppedByTemplate,
            droppedByPieceCount,
        },
    };
}

/**
 * ONE COMBO PER LINE, so a re-import reads as added, removed and changed
 * combos instead of a wall of re-indented keys. `.prettierignore` carries the
 * file for the same reason as the other line-per-row ledgers.
 */
export function serializeComboCorpus(
    source: ComboCorpusSource,
    projection: ComboCorpusProjection
): string {
    const rows = projection.combos.map((c) => `        ${JSON.stringify(c)}`);
    return [
        "{",
        `    "source": ${JSON.stringify(source)},`,
        `    "counts": ${JSON.stringify(projection.counts)},`,
        `    "combos": [`,
        rows.join(",\n"),
        "    ]",
        "}",
        "",
    ].join("\n");
}
