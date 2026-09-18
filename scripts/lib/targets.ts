/**
 * Target Lists (issue #3867, wayfinder issue #3848, map issue #3846) — the
 * roadmap's objectives as DATA: a deck list, a name list, a set, a format
 * pool, each one row of `data/targets.json`. A new objective is a row, never
 * code.
 *
 * The registry REFERENCES the sources that already exist — the Tier 1 lists,
 * the metagame import, the Vintage Cube worklist, the vendored MTGJSON sets,
 * the lockfile's `poolIn` formats — and moves none of them.
 *
 * Fail-closed, like the Tier 1 reader it generalises: an unresolved name, a
 * duplicate, a malformed row or list throws. A Target whose denominator could
 * shrink silently would report progress that does not exist.
 *
 * Reads the LOCKFILE, never the corpus — the lockfile carries one row per
 * corpus card, and only it is committed, so every figure here is reproducible
 * offline on a clean checkout.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPORTED_FORMATS } from "../oracle-corpus";
import { corpusNameIndex } from "./card-names";
import { gapOf, poolTarget } from "./grammar-gaps";
import type { CardRow, Lockfile } from "./oracle-lockfile";
import { validateDecks, type Tier1Deck } from "./tier1-decks";

/** Path of the registry, relative to the repo root. */
export const TARGETS_PATH = "data/targets.json";

export const TARGET_KINDS = [
    "deck-list",
    "name-list",
    "set",
    "format",
] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/**
 * One registered Target List.
 *
 * `source` by kind:
 * - `deck-list` — a `{ decks }` file (60 + 15 each); `path#slug` names one
 *   deck, a bare path the union of every deck in the file;
 * - `name-list` — a text file, one card name per line, `#` comments;
 * - `set` — a vendored MTGJSON set file (`data/json/<SET>.json`);
 * - `format` — a format of the lockfile's `poolIn` (`REPORTED_FORMATS`).
 *
 * `priority` is the rank order of Grammar Gaps — priority 1 first, then 2, …,
 * corpus as tie-break. Changing the order is editing these integers, by the
 * owner, in a PR. A Target with no priority is measured, not ranked by.
 */
export interface TargetRow {
    readonly id: string;
    readonly kind: TargetKind;
    readonly source: string;
    readonly priority?: number;
}

export interface TargetRegistry {
    /**
     * A Grammar Gap whose rule would unlock fewer corpus cards than this is
     * below the floor: a card whose residual gaps ALL sit below it is Hand
     * Tail. Measured as the gap's corpus `refuses` — the cards in all of
     * Magic that carry it (wayfinder issue #3848: a rule that pays for two
     * cards is a per-card script in grammar's clothing).
     */
    readonly handTailFloor: number;
    /** Whether `gaps:sync` files hand-tail issues yet (false until the APC
     *  pilot is accepted, issue #3837). Read by the filer, not here. */
    readonly handTailFiling: boolean;
    readonly targets: readonly TargetRow[];
}

/** Parse and VALIDATE the registry. Every rule is a denominator guard. */
export function parseTargetRegistry(
    text: string,
    path = TARGETS_PATH
): TargetRegistry {
    const fail = (message: string): never => {
        throw new Error(`${path}: ${message}`);
    };
    let doc: TargetRegistry;
    try {
        doc = JSON.parse(text) as TargetRegistry;
    } catch (err) {
        return fail(`does not parse: ${(err as Error).message}`);
    }
    if (!Number.isInteger(doc.handTailFloor) || doc.handTailFloor < 1)
        fail("`handTailFloor` must be a positive integer");
    if (typeof doc.handTailFiling !== "boolean")
        fail("`handTailFiling` must be a boolean");
    if (!Array.isArray(doc.targets) || doc.targets.length === 0)
        fail("`targets` must be a non-empty array");

    const ids = new Set<string>();
    const priorities = new Map<number, string>();
    for (const row of doc.targets) {
        if (
            typeof row.id !== "string" ||
            !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id)
        )
            fail(
                `a target has no kebab-case \`id\` (${JSON.stringify(row.id)})`
            );
        if (ids.has(row.id)) fail(`duplicate target id \`${row.id}\``);
        ids.add(row.id);
        if (!(TARGET_KINDS as readonly string[]).includes(row.kind))
            fail(
                `${row.id}: unknown kind \`${row.kind}\` (one of: ${TARGET_KINDS.join(", ")})`
            );
        if (typeof row.source !== "string" || row.source.length === 0)
            fail(`${row.id}: no \`source\``);
        if (
            row.kind === "format" &&
            !(REPORTED_FORMATS as readonly string[]).includes(row.source)
        )
            fail(
                `${row.id}: unknown format \`${row.source}\` (one of: ${REPORTED_FORMATS.join(", ")})`
            );
        if (row.priority !== undefined) {
            if (!Number.isInteger(row.priority) || row.priority < 1)
                fail(`${row.id}: \`priority\` must be a positive integer`);
            const other = priorities.get(row.priority);
            if (other !== undefined)
                fail(
                    `${row.id} and ${other} share priority ${row.priority} — the rank order must be total`
                );
            priorities.set(row.priority, row.id);
        }
    }
    return doc;
}

export function readTargetRegistry(root: string): TargetRegistry {
    return parseTargetRegistry(
        readFileSync(join(root, TARGETS_PATH), "utf8"),
        TARGETS_PATH
    );
}

/** One card of a resolved Target. */
export interface TargetCard {
    readonly oracleId: string;
    /** The lockfile's own name, not the list's spelling. */
    readonly name: string;
}

export interface ResolvedTarget {
    readonly row: TargetRow;
    /** Distinct cards, sorted by name. */
    readonly cards: readonly TargetCard[];
}

/** Everything a resolution reads, built once per lockfile. */
export interface ResolveContext {
    readonly root: string;
    readonly lock: Pick<Lockfile, "cards">;
    readonly byName: ReadonlyMap<string, CardRow>;
    readonly byOracleId: ReadonlyMap<string, CardRow>;
}

export function resolveContext(
    root: string,
    lock: Pick<Lockfile, "cards">
): ResolveContext {
    return {
        root,
        lock,
        byName: corpusNameIndex(lock),
        byOracleId: new Map(lock.cards.map((c) => [c.oracleId, c] as const)),
    };
}

/** Each printed card of an MTGJSON set file, reprints included. */
export function mtgjsonSetCards(
    json: unknown
): Array<{ name: string; oracleId?: string }> {
    const cards = (json as { data?: { cards?: unknown[] } }).data?.cards;
    if (!Array.isArray(cards) || cards.length === 0)
        throw new Error("an MTGJSON set file with no `data.cards`");
    return cards.map((raw) => {
        const card = raw as {
            name?: unknown;
            identifiers?: { scryfallOracleId?: unknown };
        };
        if (typeof card.name !== "string" || card.name.length === 0)
            throw new Error("an MTGJSON set card with no name");
        const id = card.identifiers?.scryfallOracleId;
        return typeof id === "string" && id.length > 0
            ? { name: card.name, oracleId: id }
            : { name: card.name };
    });
}

/** The card names of a deck-list source, main and sideboard together. */
function deckListNames(row: TargetRow, root: string): string[] {
    const [file, slug] = row.source.split("#");
    const doc = JSON.parse(readFileSync(join(root, file!), "utf8")) as {
        decks: readonly Tier1Deck[];
    };
    validateDecks(doc.decks, file!);
    const decks =
        slug === undefined
            ? doc.decks
            : doc.decks.filter((deck) => deck.slug === slug);
    if (decks.length === 0)
        throw new Error(
            `${TARGETS_PATH}: ${row.id} names deck \`${slug}\`, which ${file} does not hold`
        );
    return decks.flatMap((deck) =>
        [...deck.main, ...deck.sideboard].map((entry) => entry.name)
    );
}

/**
 * The names of a name-list source. A name listed twice throws: a list is a
 * record of what someone chose, and a duplicate is a typo in that record —
 * deduplicating it would hide whichever card was meant.
 */
export function parseNameList(text: string, where: string): string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const raw of text.split("\n")) {
        const name = raw.replace(/#.*$/, "").trim();
        if (name.length === 0) continue;
        const key = name.toLowerCase();
        if (seen.has(key))
            throw new Error(`${where}: \`${name}\` is listed twice`);
        seen.add(key);
        names.push(name);
    }
    if (names.length === 0) throw new Error(`${where}: no names`);
    return names;
}

/**
 * A registered Target as the set of cards it requires — every one a lockfile
 * row, or a throw.
 */
export function resolveTarget(
    row: TargetRow,
    ctx: ResolveContext
): ResolvedTarget {
    const where = `${TARGETS_PATH} ${row.id}`;
    const rows = new Map<string, CardRow>();
    const byNameOrThrow = (names: readonly string[], dedupe: boolean): void => {
        for (const name of names) {
            const card = ctx.byName.get(name);
            if (card === undefined)
                throw new Error(
                    `${where}: \`${name}\` is not carried by the Oracle lockfile under exactly one ` +
                        `oracle id — fix the list, or re-pin the corpus ` +
                        `(bun run oracle:corpus && bun run oracle:compile)`
                );
            if (!dedupe && rows.has(card.oracleId))
                throw new Error(
                    `${where}: \`${name}\` resolves to ${card.name}, which the list already names`
                );
            rows.set(card.oracleId, card);
        }
    };
    const byIdOrThrow = (ids: ReadonlySet<string>): void => {
        for (const id of ids) {
            const card = ctx.byOracleId.get(id);
            if (card === undefined)
                throw new Error(
                    `${where}: oracle id ${id} is not in the pinned corpus — re-pin it ` +
                        `(bun run oracle:corpus && bun run oracle:compile)`
                );
            rows.set(id, card);
        }
    };

    switch (row.kind) {
        case "deck-list":
            // A deck names a card in main AND side, and two decks share cards:
            // repetition is the format, not a typo.
            byNameOrThrow(deckListNames(row, ctx.root), true);
            break;
        case "name-list":
            byNameOrThrow(
                parseNameList(
                    readFileSync(join(ctx.root, row.source), "utf8"),
                    where
                ),
                false
            );
            break;
        case "set":
            for (const card of mtgjsonSetCards(
                JSON.parse(readFileSync(join(ctx.root, row.source), "utf8"))
            )) {
                // The oracle id first; the printed name when MTGJSON's id is
                // one the corpus does not carry (LEG's Arboria ships its
                // scryfallId in the scryfallOracleId field). Both are an
                // identity — a card neither resolves still throws.
                const byId = ctx.byOracleId.get(card.oracleId ?? "");
                if (byId !== undefined) rows.set(byId.oracleId, byId);
                else byNameOrThrow([card.name], true);
            }
            break;
        case "format":
            byIdOrThrow(poolTarget(ctx.lock, row.source));
            break;
        default: {
            const never: never = row.kind;
            throw new Error(`${where}: unknown kind ${String(never)}`);
        }
    }
    if (rows.size === 0) throw new Error(`${where}: resolves to no cards`);
    return {
        row,
        cards: [...rows.values()]
            .map((c) => ({ oracleId: c.oracleId, name: c.name }))
            .sort((a, b) =>
                a.name < b.name
                    ? -1
                    : a.name > b.name
                      ? 1
                      : a.oracleId < b.oracleId
                        ? -1
                        : 1
            ),
    };
}

// ── Coverage ───────────────────────────────────────────────────────────────

/**
 * Where the tooling stands on a Target card (CONTEXT.md § Coverage
 * Invariant) — exactly one per card:
 *
 * - `ready` — the lockfile row compiles;
 * - `quarantine` — it compiles, but is held back;
 * - `hand-tail` — not ready, and the hand-written card carries a `hand-tail:`
 *   marker: below the floor by decision;
 * - `gap-pending` — unparsed, and at least one residual Grammar Gap sits at
 *   or above the floor: the grammar owes it;
 * - `unclaimed` — unparsed, every gap below the floor (or none attributed)
 *   and no `hand-tail:` marker: nobody has decided anything.
 *
 * Whether each claim has its issue is `check:targets`' question (the next
 * slice of wayfinder issue #3848), not this report's.
 */
export const COVERAGE_STATES = [
    "ready",
    "quarantine",
    "gap-pending",
    "hand-tail",
    "unclaimed",
] as const;
export type CoverageState = (typeof COVERAGE_STATES)[number];

export interface CoverageContext {
    readonly floor: number;
    /** Oracle ids covered by a HAND-WRITTEN definition today. */
    readonly handWritten: ReadonlySet<string>;
    /** Oracle ids whose hand-written card carries a well-formed `hand-tail:`. */
    readonly handTail: ReadonlySet<string>;
    readonly byOracleId: ReadonlyMap<string, CardRow>;
    /** Each unparsed card's distinct Grammar Gap keys. */
    readonly gapKeys: (row: CardRow) => readonly string[];
    /** Gap key → the corpus cards that carry it (its `refuses`). */
    readonly leverage: ReadonlyMap<string, number>;
}

/**
 * Per-gap corpus leverage and per-card gap keys, over the whole lockfile —
 * the SAME gap key `rankGrammarGaps` groups by, so a card's gaps here are the
 * rows of the ranked backlog.
 */
export function gapIndex(lock: Pick<Lockfile, "cards" | "fragments">): {
    gapKeys: (row: CardRow) => readonly string[];
    leverage: ReadonlyMap<string, number>;
} {
    const keyOfFragment = lock.fragments.map((f) => gapOf(f).key);
    const gapKeys = (row: CardRow): string[] => [
        ...new Set((row.gaps ?? []).map((i) => keyOfFragment[i]!)),
    ];
    const leverage = new Map<string, number>();
    for (const row of lock.cards) {
        if (row.state !== "unparsed") continue;
        for (const key of gapKeys(row))
            leverage.set(key, (leverage.get(key) ?? 0) + 1);
    }
    return { gapKeys, leverage };
}

export function coverageState(
    row: CardRow,
    ctx: CoverageContext
): CoverageState {
    if (row.state === "ready") return "ready";
    if (ctx.handTail.has(row.oracleId)) return "hand-tail";
    if (row.state === "quarantine") return "quarantine";
    // One gap at or above the floor is grammar owed: once those rules land,
    // whatever stays below the floor makes the card Hand Tail — so a card with
    // mixed gaps is pending, never stuck with no green state.
    return ctx
        .gapKeys(row)
        .some((key) => (ctx.leverage.get(key) ?? 0) >= ctx.floor)
        ? "gap-pending"
        : "unclaimed";
}

/** A `hand-tail:` card the tooling has caught up with. */
export interface MigrableCard {
    readonly name: string;
    readonly why: string;
}

export interface TargetCoverage {
    readonly id: string;
    readonly kind: TargetKind;
    readonly priority?: number;
    readonly total: number;
    /** Card names per coverage state, sorted. */
    readonly byState: Readonly<Record<CoverageState, readonly string[]>>;
    /** `ready ∪ hand-written` — the v1 gate, a figure apart from the invariant. */
    readonly playable: number;
    readonly migrable: readonly MigrableCard[];
}

/**
 * A `hand-tail:` card is migrable when its lockfile row is `ready` (retire
 * the hand-written definition, ADR 0114) or when one of its residual gaps has
 * climbed to the floor (it re-enters the grammar queue).
 */
export function migrableReason(
    row: CardRow,
    ctx: CoverageContext
): string | undefined {
    if (!ctx.handTail.has(row.oracleId)) return undefined;
    if (row.state === "ready")
        return "row is ready — retire the hand-written definition (oracle:retire)";
    const above = ctx
        .gapKeys(row)
        .filter((key) => (ctx.leverage.get(key) ?? 0) >= ctx.floor);
    if (above.length === 0) return undefined;
    const key = above[0]!;
    return `gap at the floor — \`${key}\` unlocks ${ctx.leverage.get(key)} corpus cards (floor ${ctx.floor}); flip the marker to compiler-gap:`;
}

export function targetCoverage(
    target: ResolvedTarget,
    ctx: CoverageContext
): TargetCoverage {
    const byState: Record<CoverageState, string[]> = {
        ready: [],
        quarantine: [],
        "gap-pending": [],
        "hand-tail": [],
        unclaimed: [],
    };
    let playable = 0;
    const migrable: MigrableCard[] = [];
    for (const card of target.cards) {
        const row = ctx.byOracleId.get(card.oracleId)!;
        const state = coverageState(row, ctx);
        byState[state].push(card.name);
        if (state === "ready" || ctx.handWritten.has(card.oracleId))
            playable += 1;
        const why = migrableReason(row, ctx);
        if (why !== undefined) migrable.push({ name: card.name, why });
    }
    return {
        id: target.row.id,
        kind: target.row.kind,
        ...(target.row.priority === undefined
            ? {}
            : { priority: target.row.priority }),
        total: target.cards.length,
        byState,
        playable,
        migrable,
    };
}
