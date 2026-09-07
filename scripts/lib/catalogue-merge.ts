/**
 * The ONE catalogue artifact, merged at BUILD (ADR 0113 §2, ADR 0114 §2/§3).
 *
 * Today the same card can exist twice — a hand-written module under
 * `convex/cards/sets/**` and a compiled `ready` row in the Oracle lockfile —
 * and the collision used to be resolved TWICE AT RUNTIME: the retired
 * `scripts/oracle-pool.ts` dropped the compiled twin at generation,
 * `convex/cards/catalogue.ts` drops it again at hydration as a backstop
 * (ADR 0108 §4). ADR 0114 §2 replaces both with one artifact merged here, so
 * the runtime resolves nothing because nothing is left to resolve — and since
 * issue #3055 this merge renders BOTH sides of ADR 0113 §2's asymmetry, so
 * there is no second join left to disagree with.
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
 * projection keeps.
 *
 * A closure on the hand-written side makes that card's BODY incomparable and
 * NOTHING ELSE — `roundTripCard`'s own rule, taken through the same
 * `withoutBodyProjection`. Exempting a whole card on the mere PRESENCE of the
 * sentinel is the blind spot gold.ts records by name: Desert Twister writes its
 * body as the `effect: "destroy-target"` string shorthand, so a whole-card
 * exemption hides its `type: "any"` target defect behind a field nobody
 * compared. Relocation is unaffected either way — that shorthand is a STRING,
 * which is data.
 */
import { createHash } from "node:crypto";
import type { CardDefinition } from "../../convex/cards/types";
import { expandDefinition } from "../../convex/cards/registry";
import {
    behaviouralProjection,
    CLOSURE_SENTINEL,
    withoutBodyProjection,
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
    // `undefined` INSIDE an array is not the absent-key case above: JSON
    // renders the hole as `null`, and `relocationLoss` cannot see it either
    // (`sortKeys` maps element-wise and leaves the hole in place, so both
    // sides stringify to `null`). A conditional array element —
    // `effects: [op, flag ? op2 : undefined]` — is the shape this refuses.
    if (Array.isArray(value))
        return value.every((v) => v !== undefined && isPlainData(v));
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
 *  disagree after the enumerated normalisation. A card that disagrees on TWO
 *  fields yields two of these, so the baseline — keyed on `card|field` —
 *  cannot amnesty a second divergence under the row written for the first. */
export interface Divergence {
    readonly card: string;
    readonly oracleId: string;
    /** The projected key that differs. */
    readonly field: string;
    readonly expected: string;
    readonly actual: string;
}

/**
 * Compare a hand-written definition against the compiled row that would
 * replace it. An empty array means they agree — or that the only thing they
 * disagree about is a body this projection cannot compare (see the header).
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
): readonly Divergence[] {
    let expected = behaviouralProjection(expandDefinition(handWrittenRaw));
    let actual = behaviouralProjection(expandDefinition(compiled));
    if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
    if (JSON.stringify(expected).includes(CLOSURE_SENTINEL)) {
        const bodiless = withoutBodyProjection(expected);
        // The sentinel SURVIVING the strip is a closure nested inside an
        // ability, which this projection cannot separate from that ability's
        // comparable fields — the one case where the whole card is exempt.
        if (JSON.stringify(bodiless).includes(CLOSURE_SENTINEL)) return [];
        expected = bodiless;
        actual = withoutBodyProjection(actual);
        if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
    }
    const expectedFields = expected;
    const actualFields = actual;
    return [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
        .sort()
        .filter(
            (k) =>
                JSON.stringify(expectedFields[k]) !==
                JSON.stringify(actualFields[k])
        )
        .map((field) => ({
            card: handWrittenRaw.name,
            oracleId,
            field,
            expected: JSON.stringify(expectedFields[field] ?? null),
            actual: JSON.stringify(actualFields[field] ?? null),
        }));
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
    /** The artifact's rows, sorted by `id` — the CLIENT rendering. */
    readonly rows: readonly CardDefinition[];
    /**
     * The SERVER rendering: the compiled-only subset of {@link rows}, sorted
     * by `id`, and the exact same objects — `rows.filter(...)`, never a second
     * derivation (issue #3055).
     *
     * This is what `data/oracle-compiled-pool.json` holds and what
     * `convex/cards/compiledPool.ts` bundles into every Convex mutation. The
     * relocated hand-written rows are absent because the server already has
     * them as modules; the client's copy of the artifact carries them and
     * `excludeHandWritten` drops them at hydration, so both sides register the
     * SAME population from the SAME bytes.
     */
    readonly serverRows: readonly CardDefinition[];
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
            divergences.push(
                ...twinDivergence(card.raw, twin.definition, twin.oracleId)
            );
        }
        rows.push(card.raw);
        relocated++;
    }

    let compiledOnly = 0;
    const compiledOnlyIds = new Set<string>();
    for (const row of compiled) {
        if (handWrittenOracleIds.has(row.oracleId)) continue;
        rows.push(row.definition);
        compiledOnlyIds.add(row.definition.id);
        compiledOnly++;
    }

    rows.sort((a, b) => a.id.localeCompare(b.id));
    // Filtered out of the SORTED merged list rather than collected in the loop
    // above: the server rendering must be the same objects in the same order
    // as the client's, and a second sort of a second array is a second chance
    // to disagree. `compiledOnlyIds` is a set of print ids, which are unique
    // across the merge (asserted in `catalogue-artifact.test.ts`).
    const serverRows = rows.filter((r) => compiledOnlyIds.has(r.id));
    return {
        rows,
        serverRows,
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

/**
 * The SERVER rendering's bytes: `data/oracle-compiled-pool.json`.
 *
 * Four-space, not minified, and a BARE ARRAY with no header — both deliberate
 * and both load-bearing. The indentation is the shape the retired
 * `scripts/oracle-pool.ts` wrote before this generator absorbed it (issue
 * #3055), kept so the change
 * that made the two renderings one source moved no committed byte; the bare
 * array is the merge-conflict immunity `scripts/lib/generated-artifacts.ts`
 * records and `scripts/__tests__/generated-artifact-merge.test.ts` pins — a
 * header field holding a hash or a tally is whole-file state, and two branches
 * that both regenerate would then collide on a line neither of them touched.
 *
 * So the source hash is NOT in here. It rides in
 * {@link SOURCE_HASH_FILE} beside the artifact, which the server bundles
 * through `convex/cards/compiledCatalogue.ts`.
 */
export function serializePool(rows: readonly CardDefinition[]): string {
    return JSON.stringify(rows, null, 4) + "\n";
}

/** The server's copy of the source hash — one generated file, so the hash is
 *  never a literal a human can edit out of agreement with the bytes. Sits
 *  inside {@link CATALOGUE_DIR}, which the client's `catalogue-*.json` glob
 *  does not match. */
export const SOURCE_HASH_FILE = "source-hash.json";

export const serializeSourceHash = (hash: string): string =>
    JSON.stringify({ hash }, null, 4) + "\n";

/**
 * A byte-level disagreement between the two renderings of ONE shared
 * definition — the drift ADR 0113 §2 names as the price of the asymmetry
 * ("the server module and the client asset could disagree").
 *
 * It does not crash. The server resolves a spell one way and the client's
 * Brain plans against another: a wrong move, or a UI showing something the
 * server never applied. So it is reported with the CARD on it, not as a
 * boolean.
 */
export interface IdentityDrift {
    /** `count` — one side has rows the other does not; `id` — the two
     *  populations diverge in membership or order; `bytes` — the same card,
     *  two different definitions. `bytes` is the dangerous one. */
    readonly kind: "count" | "id" | "bytes";
    /** Row index, in the shared `id` order. */
    readonly at: number;
    readonly card: string;
    readonly server: string;
    readonly client: string;
}

/**
 * The FIRST place the server-bundled definitions and the client artifact
 * disagree, or `null` when every shared definition is byte-identical.
 *
 * Byte comparison and not `toEqual`: two objects can deep-equal while
 * serializing differently (key order), and it is the SERIALIZED form the
 * client receives over the wire — so the bytes are what has to agree, not an
 * equality the wire never sees.
 *
 * First, not all: a drift is a stale regeneration, which moves hundreds of
 * rows at once. The first card is the diagnosis; the rest is the same
 * sentence repeated.
 */
export function firstIdentityDrift(
    server: readonly CardDefinition[],
    client: readonly CardDefinition[]
): IdentityDrift | null {
    const shared = Math.min(server.length, client.length);
    for (let i = 0; i < shared; i++) {
        const s = server[i]!;
        const c = client[i]!;
        if (s.id !== c.id) {
            return {
                kind: "id",
                at: i,
                card: `${s.name} (${s.id}) vs ${c.name} (${c.id})`,
                server: s.id,
                client: c.id,
            };
        }
        const serverBytes = JSON.stringify(s);
        const clientBytes = JSON.stringify(c);
        if (serverBytes !== clientBytes) {
            return {
                kind: "bytes",
                at: i,
                card: `${s.name} (${s.id})`,
                server: serverBytes,
                client: clientBytes,
            };
        }
    }
    if (server.length !== client.length) {
        const longer = server.length > client.length ? server : client;
        const extra = longer[shared]!;
        return {
            kind: "count",
            at: shared,
            card: `${extra.name} (${extra.id})`,
            server: String(server.length),
            client: String(client.length),
        };
    }
    return null;
}

/** One line naming the first differing card, for a gate message. */
export function describeIdentityDrift(drift: IdentityDrift): string {
    switch (drift.kind) {
        case "count":
            return (
                `row count differs — server ${drift.server}, client ${drift.client}; ` +
                `first unmatched: ${drift.card}`
            );
        case "id":
            return `row ${drift.at} is a different card — ${drift.card}`;
        case "bytes":
            return (
                `${drift.card} is TWO definitions:\n` +
                `      server: ${drift.server}\n` +
                `      client: ${drift.client}`
            );
    }
}
