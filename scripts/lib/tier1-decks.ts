/**
 * The Premodern Tier 1 lists as canonical data, and the per-card state report
 * built from them (issue #2696, PRD #2693 user story 8).
 *
 * M1's "done" is a checklist a machine can read: for every card in every Tier 1
 * list, is it playable today, and if not, what is in the way. The six supplied
 * lists live verbatim in `data/premodern-tier1-decks.json`; this module turns
 * one of them plus the Oracle lockfile into a row per card.
 *
 * Reads the LOCKFILE, never the corpus — same contract as `oracle-report.ts`:
 * the report must be reproducible on a clean checkout with no network and no
 * 24 MB cache, so two people quoting a deck's number are quoting the same run.
 *
 * Fail-closed everywhere, because a deck report that quietly skips a card it
 * could not resolve reports progress that does not exist. A name absent from
 * the corpus, a name the corpus carries twice, a list that is not 60 + 15 —
 * each throws rather than shrinking the denominator.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CompileState } from "../../convex/oracle/types";
import type { CardRow, Lockfile } from "./oracle-lockfile";

/** Path of the canonical lists, relative to the repo root. */
export const TIER1_DECKS_PATH = "data/premodern-tier1-decks.json";

/** Premodern deck construction: exactly 60 maindeck, exactly 15 sideboard. */
export const TIER1_MAIN_SIZE = 60;
export const TIER1_SIDEBOARD_SIZE = 15;

/**
 * What a Tier 1 card is, from the engine's point of view.
 *
 * `ours` is not a compiler state at all — it is the card being covered by a
 * HAND-WRITTEN definition, which the compiler's own states know nothing about.
 * It wins over whatever the lockfile says: a hand-written card is playable
 * today regardless of whether the grammar has learned to reproduce it.
 */
export type DeckCardState = "ours" | CompileState;

/**
 * Playable today: shipped by hand, or compiled and served from the pool.
 *
 * The ONE definition — `deckReport` derives its `playable` figure by summing
 * these counts rather than re-listing the two states, so a change to what
 * counts as playable cannot update the constant and leave the arithmetic
 * behind (review of issue #2696, finding 3).
 */
export const PLAYABLE_STATES: readonly DeckCardState[] = ["ours", "ready"];

export interface Tier1DeckEntry {
    readonly count: number;
    readonly name: string;
}

export interface Tier1Deck {
    readonly slug: string;
    readonly name: string;
    readonly main: readonly Tier1DeckEntry[];
    readonly sideboard: readonly Tier1DeckEntry[];
}

/**
 * A Premodern preset that has already shipped, referenced by its `presetDecks`
 * SLUG and nothing else.
 *
 * Deliberately not a card list: the preset's cards live in the DB (ADR 0033),
 * every one of them is hand-written by construction, and copying them here
 * would create a second source of truth that drifts the first time an Admin
 * edits the preset. The slug is the join key; the report names it and stops.
 */
export interface ShippedPreset {
    readonly slug: string;
    readonly name: string;
}

export interface Tier1DeckFile {
    readonly source: {
        readonly supplier: string;
        readonly suppliedOn: string;
        readonly note: string;
    };
    readonly shippedPresets: readonly ShippedPreset[];
    readonly decks: readonly Tier1Deck[];
}

/** Where in the 75 a card appears. A card can be in both. */
export type DeckSlot = "main" | "side" | "both";

export interface DeckCardRow {
    readonly name: string;
    readonly oracleId: string;
    readonly state: DeckCardState;
    readonly slot: DeckSlot;
    /** Copies across main and sideboard together. */
    readonly copies: number;
    /**
     * What stands between this card and being playable, in the words of the
     * lockfile row: the first unconsumed FRAGMENT for `unparsed` (the sentence
     * the grammar has to learn next), the first quarantine REASON for
     * `quarantine`. Absent for a playable card, which has no blocker.
     *
     * One field rather than two, because the reader's question is the same in
     * both states — "why not yet?" — and a report with a `fragment` column and
     * a `reason` column would have one of them empty on every row.
     */
    readonly blocker?: string;
}

export interface DeckReport {
    readonly slug: string;
    readonly name: string;
    /** One row per DISTINCT card, sorted by name. */
    readonly cards: readonly DeckCardRow[];
    readonly counts: Readonly<Record<DeckCardState, number>>;
    /** `ours + ready` — the numerator of the summary line. */
    readonly playable: number;
    /** Distinct cards in the list — the denominator. */
    readonly total: number;
}

function fail(message: string): never {
    throw new Error(`${TIER1_DECKS_PATH}: ${message}`);
}

function totalCopies(entries: readonly Tier1DeckEntry[]): number {
    return entries.reduce((sum, e) => sum + e.count, 0);
}

/**
 * Parse and VALIDATE the canonical lists.
 *
 * The validation is the point: this file is hand-maintained (it is a record of
 * what the maintainer supplied, not something a script regenerates), so the
 * only thing standing between a fat-fingered edit and a silently wrong
 * denominator is this function. A list that is not 60 + 15 is not a Premodern
 * deck, and a report built from it would answer a question nobody asked.
 */
export function parseTier1Decks(
    text: string,
    path = TIER1_DECKS_PATH
): Tier1DeckFile {
    let doc: Tier1DeckFile;
    try {
        doc = JSON.parse(text) as Tier1DeckFile;
    } catch (err) {
        throw new Error(`${path} does not parse: ${(err as Error).message}`);
    }
    if (!Array.isArray(doc.decks) || doc.decks.length === 0)
        fail("no decks — the canonical lists are missing");
    if (!Array.isArray(doc.shippedPresets))
        fail("`shippedPresets` must be an array of { slug, name }");

    const slugs = new Set<string>();
    for (const deck of doc.decks) {
        if (typeof deck.slug !== "string" || deck.slug.length === 0)
            fail("a deck has no slug");
        if (slugs.has(deck.slug)) fail(`duplicate deck slug \`${deck.slug}\``);
        slugs.add(deck.slug);
        for (const section of ["main", "sideboard"] as const) {
            const entries = deck[section];
            if (!Array.isArray(entries))
                fail(`${deck.slug}: \`${section}\` must be an array`);
            for (const entry of entries) {
                if (!Number.isInteger(entry.count) || entry.count < 1)
                    fail(
                        `${deck.slug}/${section}: \`${entry.name}\` has a non-positive count`
                    );
                if (typeof entry.name !== "string" || entry.name.length === 0)
                    fail(`${deck.slug}/${section}: an entry has no name`);
            }
        }
        const main = totalCopies(deck.main);
        const side = totalCopies(deck.sideboard);
        if (main !== TIER1_MAIN_SIZE || side !== TIER1_SIDEBOARD_SIZE)
            fail(
                `${deck.slug} is ${main} + ${side}, not ${TIER1_MAIN_SIZE} + ${TIER1_SIDEBOARD_SIZE} — ` +
                    `the lists are stored exactly as supplied, so this is an edit, not a format change`
            );
    }
    return doc;
}

export function readTier1Decks(root: string): Tier1DeckFile {
    const path = join(root, TIER1_DECKS_PATH);
    return parseTier1Decks(readFileSync(path, "utf8"), TIER1_DECKS_PATH);
}

/**
 * Name → lockfile row, with the ambiguous names REMOVED rather than resolved.
 *
 * 76 corpus names are carried by more than one oracle id (Un-set variants of
 * "Ineffable Blessing" and friends). Picking one arbitrarily would let a deck
 * report a state that belongs to a different card, so an ambiguous name
 * resolves to nothing and `deckReport` throws if a list actually names one —
 * a loud stop on a card no Tier 1 list contains today, rather than a silent
 * wrong answer the day one does.
 */
export function lockfileRowsByName(
    lock: Lockfile
): ReadonlyMap<string, CardRow> {
    const byName = new Map<string, CardRow>();
    const ambiguous = new Set<string>();
    for (const row of lock.cards) {
        if (byName.has(row.name)) ambiguous.add(row.name);
        else byName.set(row.name, row);
    }
    for (const name of ambiguous) byName.delete(name);
    return byName;
}

/**
 * The row's own account of why it is not playable. `ours` and `ready` have
 * none — a playable card is not blocked on anything.
 */
function blockerOf(
    state: DeckCardState,
    row: CardRow,
    fragments: readonly { readonly text: string }[]
): string | undefined {
    if (state === "unparsed") {
        const gap = row.gaps?.[0];
        return gap === undefined ? undefined : fragments[gap]?.text;
    }
    if (state === "quarantine") {
        const reason = row.quarantineReasons?.[0];
        return reason === undefined
            ? undefined
            : `${reason.kind}: ${reason.detail}`;
    }
    return undefined;
}

function slotOf(inMain: boolean, inSide: boolean): DeckSlot {
    if (inMain && inSide) return "both";
    return inMain ? "main" : "side";
}

/**
 * One deck's card-by-card state.
 *
 * Distinct CARDS, not the 75 slots: "is this card playable" is a fact about the
 * card, so four copies of Goblin Lackey are one row and one unit of progress.
 * The copy count rides along because a missing 4-of and a missing 1-of are not
 * the same problem.
 */
export function deckReport(
    deck: Tier1Deck,
    rowsByName: ReadonlyMap<string, CardRow>,
    fragments: readonly { readonly text: string }[],
    poolOracleIds: ReadonlySet<string>
): DeckReport {
    const copies = new Map<string, number>();
    const inMain = new Set<string>();
    const inSide = new Set<string>();
    for (const entry of deck.main) {
        copies.set(entry.name, (copies.get(entry.name) ?? 0) + entry.count);
        inMain.add(entry.name);
    }
    for (const entry of deck.sideboard) {
        copies.set(entry.name, (copies.get(entry.name) ?? 0) + entry.count);
        inSide.add(entry.name);
    }

    const cards: DeckCardRow[] = [];
    const counts: Record<DeckCardState, number> = {
        ours: 0,
        ready: 0,
        quarantine: 0,
        unparsed: 0,
    };
    for (const name of [...copies.keys()].sort()) {
        const row = rowsByName.get(name);
        if (row === undefined) {
            throw new Error(
                `${TIER1_DECKS_PATH}: ${deck.slug} names \`${name}\`, which the Oracle ` +
                    `lockfile does not carry under exactly one oracle id — fix the list, or ` +
                    `re-pin the corpus (bun run oracle:corpus && bun run oracle:compile)`
            );
        }
        const state: DeckCardState = poolOracleIds.has(row.oracleId)
            ? "ours"
            : row.state;
        counts[state] += 1;
        const blocker = blockerOf(state, row, fragments);
        cards.push({
            name,
            oracleId: row.oracleId,
            state,
            slot: slotOf(inMain.has(name), inSide.has(name)),
            copies: copies.get(name) ?? 0,
            ...(blocker === undefined ? {} : { blocker }),
        });
    }
    return {
        slug: deck.slug,
        name: deck.name,
        cards,
        counts,
        playable: PLAYABLE_STATES.reduce((sum, s) => sum + counts[s], 0),
        total: cards.length,
    };
}

/** Every canonical list's report, in file order. */
export function tier1Reports(
    file: Tier1DeckFile,
    lock: Lockfile,
    poolOracleIds: ReadonlySet<string>
): DeckReport[] {
    const rowsByName = lockfileRowsByName(lock);
    return file.decks.map((deck) =>
        deckReport(deck, rowsByName, lock.fragments, poolOracleIds)
    );
}

/** `18/25 ready  (17 ours, 1 ready, 1 quarantine, 6 unparsed)` */
export function summaryLine(report: DeckReport): string {
    const { counts } = report;
    return (
        `${report.slug.padEnd(20)}${`${report.playable}/${report.total}`.padStart(7)} ready  ` +
        `(${counts.ours} ours, ${counts.ready} ready, ` +
        `${counts.quarantine} quarantine, ${counts.unparsed} unparsed)`
    );
}

/**
 * The whole per-deck summary as lines — the surface the progress snapshot
 * asserts on, so the test and the CLI can never drift into reporting different
 * numbers for the same tree.
 */
export function summaryLines(reports: readonly DeckReport[]): string[] {
    return reports.map(summaryLine);
}
