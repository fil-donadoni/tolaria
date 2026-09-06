/**
 * The ONE catalogue artifact, merged at BUILD (ADR 0113 §2, ADR 0114 §2/§3).
 *
 * Today the same card can exist twice — a hand-written module under
 * `convex/cards/sets/**` and a compiled `ready` row in the Oracle lockfile —
 * and the collision is resolved TWICE AT RUNTIME: `scripts/oracle-pool.ts`
 * drops the compiled twin at generation, `convex/cards/catalogue.ts` drops it
 * again at hydration as a backstop (ADR 0108 §4). ADR 0114 §2 replaces both
 * with one artifact merged here, so the runtime resolves nothing because
 * nothing is left to resolve.
 *
 * ── The three populations ──────────────────────────────────────────────────
 *
 *  1. RELOCATED. A hand-written definition that is plain data end to end
 *     ({@link isPlainData}) is copied into the artifact VERBATIM. This is a
 *     move, not a recompile: it carries no behavioural claim, and
 *     {@link relocationLoss} proves it by round-tripping the row through JSON
 *     and deep-comparing it against the live definition.
 *  2. COMPILED-ONLY. A `ready` lockfile row whose oracle id no hand-written
 *     definition covers. Exactly today's pool population.
 *  3. TWINS. Both exist. ONE row is written — the hand-written one, because
 *     that is the copy the deep-equality claim covers — and the compiled row's
 *     job at a twin is to CHECK, not to supply. Where the two disagree the
 *     build FAILS and names the card and the field (ADR 0114 §3): no silent
 *     winner in either direction, because the measured residue proved the
 *     hand-written side is not reliably the correct one (Ashnod's Altar,
 *     Northern Paladin).
 *
 * A hand-written definition that is NOT plain data (a `resolve()` body, a
 * `matches` predicate) stays a module and stays out of the artifact, and so
 * does its compiled twin: the module is what the engine runs, so putting the
 * twin in the artifact would register a second, differing definition for the
 * same id. That is the collision this merge exists to delete, not to move.
 *
 * ── The comparator is `convex/oracle/gold.ts`, unchanged ───────────────────
 *
 * `behaviouralProjection` on both sides, with its ENUMERATED normalisation
 * axes (`SHORTHAND_ARRAY_KEYS`, `MANA_COST_KEYS`, `sortKeys`, the dead
 * mana-ability closure elision) and nothing added — ADR 0114 §4 forbids
 * folding any field the engine reads to decide (`useStack`, `cost`, `effects`,
 * `targetRequirement`, `manaProduced`), and those are exactly the fields the
 * projection keeps. A card whose hand-written projection carries the closure
 * sentinel is INCOMPARABLE rather than divergent, the same verdict
 * `roundTripCard` reaches for it: a `resolve()` and an Effect Script are not
 * comparable in either direction. Its relocation is unaffected — the sentinel
 * can come from the `effect: "<name>"` string shorthand, which is data.
 */
import { createHash } from "node:crypto";
import type { CardDefinition } from "../../convex/cards/types";
import { expandDefinition } from "../../convex/cards/registry";
import {
    behaviouralProjection,
    CLOSURE_SENTINEL,
} from "../../convex/oracle/gold";
import { sortKeys } from "../../convex/oracle/gates";

/** Where the merged artifact lives. Content-addressed FILE NAME, so the
 *  directory holds exactly one file and its name is its own checksum. */
export const CATALOGUE_DIR = "data/catalogue";

/** How many hex characters of the sha256 go in the file name. 64 bits is
 *  past any collision that could arise from a repo's worth of regenerations,
 *  and short enough to read in a diff. */
const HASH_CHARS = 16;

export const artifactFileName = (hash: string): string =>
    `catalogue-${hash}.json`;

/** sha256 of the artifact's own bytes, truncated. The name IS the provenance
 *  the asset carries; everything else stays on the lockfile (ADR 0114 §2). */
export function contentHash(bytes: string): string {
    return createHash("sha256")
        .update(bytes, "utf-8")
        .digest("hex")
        .slice(0, HASH_CHARS);
}

/**
 * Is this value plain, serializable data, all the way down?
 *
 * The relocatable population is defined by this predicate rather than by "has
 * no function" because JSON silently swallows more than functions: a `Set`
 * serializes to `{}`, a `Date` to a string, `NaN` and `Infinity` to `null`,
 * and every one of those would relocate a card into an artifact that no
 * longer says what the module said. Symbols and bigints are refused for the
 * same reason (a bigint THROWS, which is at least loud, but the predicate
 * should not depend on that).
 *
 * `undefined` is accepted only as an object VALUE, where it is equivalent to
 * an absent key on both sides of the round-trip — that is how optional
 * `CardDefinition` fields are written.
 */
export function isPlainData(value: unknown): boolean {
    if (value === null) return true;
    switch (typeof value) {
        case "string":
        case "boolean":
            return true;
        case "number":
            return Number.isFinite(value);
        case "undefined":
            return true;
        case "object":
            break;
        default:
            // function, symbol, bigint
            return false;
    }
    if (Array.isArray(value)) return value.every(isPlainData);
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    return Object.values(value as Record<string, unknown>).every(isPlainData);
}

/**
 * What a JSON round-trip would COST this definition, or `null` if nothing.
 *
 * The relocation's proof obligation, and deliberately independent of
 * {@link isPlainData}: one asks whether the shape is relocatable, the other
 * asks whether the bytes that came back say the same thing. `sortKeys` is the
 * comparison because it renders a function as `"[closure]"` instead of letting
 * `JSON.stringify` drop it silently — a definition that lost a closure would
 * otherwise compare EQUAL to the row that lost it.
 */
export function relocationLoss(
    definition: CardDefinition
): { readonly before: string; readonly after: string } | null {
    const before = JSON.stringify(sortKeys(definition));
    const after = JSON.stringify(
        sortKeys(JSON.parse(JSON.stringify(definition)))
    );
    return before === after ? null : { before, after };
}

/** One field on which a hand-written definition and its compiled twin
 *  disagree after the enumerated normalisation. */
export interface Divergence {
    readonly card: string;
    readonly oracleId: string;
    /** The projected key that differs — the first one, in sorted order. */
    readonly field: string;
    readonly expected: string;
    readonly actual: string;
}

/**
 * Compare a hand-written definition against the compiled row that would
 * replace it. `null` means they agree, or that the hand-written side is
 * incomparable (see this file's header).
 *
 * Both sides are EXPANDED first (ADR 0054), the same way `roundTripCard`
 * does it: the artifact stores raw definitions and the registry expands on
 * read, so a keyword's implicit triggers must be present on both sides or
 * absent from both.
 */
export function twinDivergence(
    handWrittenRaw: CardDefinition,
    compiled: CardDefinition,
    oracleId: string
): Divergence | null {
    const expectedProjection = behaviouralProjection(
        expandDefinition(handWrittenRaw)
    );
    const expected = JSON.stringify(expectedProjection);
    if (expected.includes(CLOSURE_SENTINEL)) return null;
    const actualProjection = behaviouralProjection(expandDefinition(compiled));
    const actual = JSON.stringify(actualProjection);
    if (expected === actual) return null;
    const keys = [
        ...new Set([
            ...Object.keys(expectedProjection),
            ...Object.keys(actualProjection),
        ]),
    ].sort();
    const field =
        keys.find(
            (k) =>
                JSON.stringify(expectedProjection[k]) !==
                JSON.stringify(actualProjection[k])
        ) ?? "(whole definition)";
    return {
        card: handWrittenRaw.name,
        oracleId,
        field,
        expected: JSON.stringify(expectedProjection[field] ?? null),
        actual: JSON.stringify(actualProjection[field] ?? null),
    };
}

/** A hand-written definition, as its module declares it, plus the oracle id
 *  `data/card-index.json` gives it. */
export interface HandWrittenCard {
    readonly raw: CardDefinition;
    /** `undefined` when the card index has no row for this definition — the
     *  card can still be relocated, it just has no twin to check against. */
    readonly oracleId: string | undefined;
}

/** A `ready` lockfile row, joined to the `id`/`rarity` the compiler is
 *  forbidden from emitting (`convex/oracle/types.ts`). */
export interface CompiledCard {
    readonly oracleId: string;
    readonly definition: CardDefinition;
}

export interface MergeResult {
    /** The artifact's rows, sorted by `id`. */
    readonly rows: readonly CardDefinition[];
    readonly relocated: number;
    readonly compiledOnly: number;
    readonly twins: number;
    /** Hand-written definitions that carry code and so stay modules. */
    readonly unrelocatable: readonly string[];
    /** Compiled rows dropped because their card's hand-written definition
     *  stays a module — the merge cannot claim to replace what it cannot
     *  relocate. */
    readonly withheld: readonly string[];
    readonly divergences: readonly Divergence[];
    /** Relocations whose JSON round-trip lost something. Always empty on a
     *  healthy tree; a non-empty list is a hard stop, not a baseline. */
    readonly lossy: readonly string[];
}

export function mergeCatalogue(
    handWritten: readonly HandWrittenCard[],
    compiled: readonly CompiledCard[]
): MergeResult {
    const compiledByOracleId = new Map(compiled.map((c) => [c.oracleId, c]));
    const handWrittenOracleIds = new Set(
        handWritten
            .map((c) => c.oracleId)
            .filter((id): id is string => id !== undefined)
    );

    const rows: CardDefinition[] = [];
    const unrelocatable: string[] = [];
    const withheld: string[] = [];
    const divergences: Divergence[] = [];
    const lossy: string[] = [];
    let relocated = 0;
    let twins = 0;

    for (const card of handWritten) {
        if (!isPlainData(card.raw)) {
            unrelocatable.push(card.raw.name);
            if (
                card.oracleId !== undefined &&
                compiledByOracleId.has(card.oracleId)
            ) {
                withheld.push(card.raw.name);
            }
            continue;
        }
        if (relocationLoss(card.raw) !== null) lossy.push(card.raw.name);
        const twin =
            card.oracleId === undefined
                ? undefined
                : compiledByOracleId.get(card.oracleId);
        if (twin !== undefined) {
            twins++;
            const divergence = twinDivergence(
                card.raw,
                twin.definition,
                twin.oracleId
            );
            if (divergence !== null) divergences.push(divergence);
        }
        rows.push(card.raw);
        relocated++;
    }

    let compiledOnly = 0;
    for (const row of compiled) {
        if (handWrittenOracleIds.has(row.oracleId)) continue;
        rows.push(row.definition);
        compiledOnly++;
    }

    rows.sort((a, b) => a.id.localeCompare(b.id));
    return {
        rows,
        relocated,
        compiledOnly,
        twins,
        unrelocatable,
        withheld,
        divergences,
        lossy,
    };
}

/** The artifact's bytes: minified, newline-terminated, deterministic. The
 *  committed shape is NOT prettified — `data/catalogue/` is in
 *  `.prettierignore` for the same reason `data/oracle-compiled-pool.json` is
 *  (ADR 0105), and ~60% of that file's bytes are prettier whitespace. */
export function serializeCatalogue(rows: readonly CardDefinition[]): string {
    return JSON.stringify(rows) + "\n";
}
