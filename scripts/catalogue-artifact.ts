#!/usr/bin/env bun
/**
 * `bun run catalogue:pack` — writes THE catalogue artifact (issue #3052,
 * ADR 0113 §2, ADR 0114 §2/§3).
 *
 * One merged, minified, content-addressed, committed file under
 * `data/catalogue/`, holding:
 *
 *   - every hand-written definition that is plain data end to end, relocated
 *     VERBATIM (a move, not a recompile — proved by a JSON round-trip that is
 *     deep-compared against the live definition);
 *   - every compiled `ready` row whose card has no hand-written definition;
 *   - ONE row where both exist, after proving they agree.
 *
 * Pure JOIN of three already-committed, OFFLINE sources — no network:
 * the live module graph (`convex/cards/catalogue.ts`), the compiler's
 * lockfile (`data/oracle-compiled.json`) and the card index
 * (`data/card-index.json`, for the `id`/`rarity` the compiler is forbidden
 * from emitting and for the oracle id a hand-written definition covers).
 *
 * ── It writes BOTH renderings of ADR 0113 §2's asymmetry (issue #3055) ─────
 *
 * The server cannot fetch and the client cannot afford the bundle bytes, so
 * the same definitions are delivered two ways. The ADR names the price
 * outright: "the server module and the client asset could disagree, which is
 * the worst bug class available here (the client is only a view, but the Brain
 * decides moves)". A drifted definition does not crash — the server resolves a
 * spell one way and the Brain plans against another.
 *
 * It is paid HERE, structurally, before any check runs: this script emits
 *
 *   - `data/catalogue/catalogue-<hash>.json` — the CLIENT asset, every merged
 *     row, minified, content-addressed by its own bytes;
 *   - `data/oracle-compiled-pool.json` — the SERVER rendering, `merge.rows`
 *     FILTERED (`merge.serverRows`), never a second join. Until issue #3055
 *     this file had its own generator, `scripts/oracle-pool.ts`, joining the
 *     same two sources by slightly different rules — two derivations of one
 *     population, which is the drift class itself;
 *   - `data/catalogue/source-hash.json` — the ONE source hash, which the
 *     server bundles through `convex/cards/compiledCatalogue.ts` and the
 *     client carries in the artifact's file NAME. Two independently written
 *     records of one generation, so taking one side of a merge is visible.
 *
 * `--check` writes nothing. It compares the two COMMITTED renderings against
 * each other first — byte-for-byte on the definitions they share, naming the
 * first card that differs — and only then compares each of the three against a
 * fresh regeneration. Identity first because a stale rendering fails both and
 * the first message is the one the reader gets: "Venerable Knight is TWO
 * definitions" is a diagnosis, "the pool is not what the tree generates" is
 * not. That is the identity + freshness guard
 * `scripts/__tests__/catalogue-artifact.test.ts` runs in the gate: it is what
 * makes ADR 0114 §2's claim true, that a hand-written card added without
 * regenerating is CAUGHT rather than filtered away in silence, and ADR 0113
 * §2's, that the asymmetry is safe rather than merely cheap.
 *
 * Deterministic + idempotent: same three inputs -> byte-identical output,
 * sorted by `id`. Never hand-edited.
 */
import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { getAllRawCards } from "../convex/cards/catalogue";
import type { CardDefinition } from "../convex/cards/types";
import {
    CATALOGUE_DIR,
    SOURCE_HASH_FILE,
    artifactFileName,
    contentHash,
    describeIdentityDrift,
    firstIdentityDrift,
    mergeCatalogue,
    serializeCatalogue,
    serializePool,
    serializeSourceHash,
    type CompiledCard,
    type HandWrittenCard,
    type MergeResult,
} from "./lib/catalogue-merge";
import {
    BASELINE_KEYS,
    baselineKey,
} from "./lib/catalogue-divergence-baseline";

type Rarity = "common" | "uncommon" | "rare" | "mythic";

interface CardIndexEntry {
    name: string;
    oracleId: string;
    firstPrintId: string;
    rarity?: Rarity;
    source?: "compiled";
}

interface ReadyRow {
    oracleId: string;
    name: string;
    state: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque JSON passthrough, shaped like CompiledDefinition
    definition?: Record<string, any>;
}

export interface CatalogueBuild {
    readonly merge: MergeResult;
    /** The CLIENT asset's bytes. */
    readonly bytes: string;
    /** The SERVER rendering's bytes — `data/oracle-compiled-pool.json`. */
    readonly poolBytes: string;
    /** The source hash sidecar's bytes — `data/catalogue/source-hash.json`. */
    readonly sourceHashBytes: string;
    readonly hash: string;
    readonly fileName: string;
    /** `ready` rows the join could not resolve an `id`/`rarity` for. */
    readonly unjoinable: number;
}

/** Build the artifact from the tree. Every input is committed and offline. */
export function buildCatalogue(repoRoot: string): CatalogueBuild {
    const lockfile = JSON.parse(
        readFileSync(resolve(repoRoot, "data/oracle-compiled.json"), "utf-8")
    ) as { cards: ReadyRow[] };
    const cardIndex = JSON.parse(
        readFileSync(resolve(repoRoot, "data/card-index.json"), "utf-8")
    ) as CardIndexEntry[];

    const indexByOracleId = new Map(cardIndex.map((e) => [e.oracleId, e]));
    const oracleIdByPrintId = new Map(
        cardIndex
            .filter((e) => e.source !== "compiled")
            .map((e) => [e.firstPrintId, e.oracleId])
    );

    const handWritten: HandWrittenCard[] = getAllRawCards().map((raw) => ({
        raw,
        oracleId: oracleIdByPrintId.get(raw.id),
    }));
    // `rarity` lives on the card-index row for a COMPILED card and on the
    // definition for a hand-written one — measured: 2,280/2,280 compiled rows
    // carry it, 0/2,059 hand-written rows do. So this map is what lets a TWIN
    // be joined at all, and without it every twin would fall out of the join
    // unchecked rather than be compared.
    const rarityByOracleId = new Map(
        handWritten
            .filter((c) => c.oracleId !== undefined)
            .map((c) => [c.oracleId as string, c.raw.rarity])
    );

    const compiled: CompiledCard[] = [];
    let unjoinable = 0;
    for (const row of lockfile.cards) {
        if (row.state !== "ready" || row.definition === undefined) continue;
        const entry = indexByOracleId.get(row.oracleId);
        if (entry === undefined) {
            unjoinable++;
            continue;
        }
        // A row this join cannot complete can never be EMITTED, so it is
        // COUNTED and the build stops on it (see `main`) rather than written
        // with a placeholder. The retired `scripts/oracle-pool.ts` tolerated
        // the same hole silently (issue #3055 absorbed it); here it must not,
        // because a `ready` row dropped for a missing index field is also a
        // twin that never gets CHECKED — a
        // divergence would leave through the JOIN rather than through the
        // comparator, which is the one way past a gate that is otherwise
        // fail-closed.
        const rarity = entry.rarity ?? rarityByOracleId.get(row.oracleId);
        if (rarity === undefined) {
            unjoinable++;
            continue;
        }
        compiled.push({
            oracleId: row.oracleId,
            definition: {
                ...row.definition,
                id: entry.firstPrintId,
                rarity,
            } as CardDefinition,
        });
    }

    const merge = mergeCatalogue(handWritten, compiled);
    const bytes = serializeCatalogue(merge.rows);
    const hash = contentHash(bytes);
    // The hash of the CLIENT asset's bytes is the source hash for both
    // renderings: those bytes are the whole merged source, and the server's
    // rendering is a filter of it. A hash of the server half alone would move
    // for a subset of the changes and agree across the rest — the drift this
    // guards is exactly a regeneration that reached one side only.
    return {
        merge,
        bytes,
        poolBytes: serializePool(merge.serverRows),
        sourceHashBytes: serializeSourceHash(hash),
        hash,
        fileName: artifactFileName(hash),
        unjoinable,
    };
}

/** The SERVER rendering's path. One importer,
 *  `convex/cards/compiledPool.ts` (pinned by
 *  `scripts/__tests__/compiled-pool-client-seam.test.ts`). */
export const POOL_PATH = "data/oracle-compiled-pool.json";

const readCommitted = (repoRoot: string, path: string): string | null => {
    const full = resolve(repoRoot, path);
    return existsSync(full) ? readFileSync(full, "utf-8") : null;
};

/**
 * The client's rendering of the SHARED definitions: the artifact's rows minus
 * the relocated hand-written ones.
 *
 * This is `excludeHandWritten` at the CLIENT's own seam — the artifact carries
 * the hand-written rows too and the browser drops them in favour of the
 * modules the engine runs (`convex/cards/compiledCatalogue.ts`). So what is
 * left is exactly the population the server bundles, and it is the only
 * population the two sides can disagree about.
 */
export function sharedClientRows(
    rows: readonly CardDefinition[]
): CardDefinition[] {
    const handWrittenIds = new Set(getAllRawCards().map((c) => c.id));
    return rows.filter((r) => !handWrittenIds.has(r.id));
}

/**
 * Compare the two COMMITTED renderings — the question ADR 0113 §2 poses, asked
 * of the bytes on disk rather than of a regeneration (issue #3055).
 *
 * `null` when a file is missing: that is the freshness check's failure to
 * report, and reporting it twice would name the wrong remedy.
 */
export function committedIdentityDrift(repoRoot: string) {
    const pool = readCommitted(repoRoot, POOL_PATH);
    const artifacts = committedArtifacts(repoRoot);
    if (pool === null || artifacts.length !== 1) return null;
    const artifact = readCommitted(
        repoRoot,
        join(CATALOGUE_DIR, artifacts[0]!)
    );
    if (artifact === null) return null;
    return firstIdentityDrift(
        JSON.parse(pool) as CardDefinition[],
        sharedClientRows(JSON.parse(artifact) as CardDefinition[])
    );
}

/** Divergences the baseline does not cover — the build's stop condition. */
export const unbaselinedDivergences = (build: CatalogueBuild) =>
    build.merge.divergences.filter((d) => !BASELINE_KEYS.has(baselineKey(d)));

/** The artifact files currently committed under `data/catalogue/`. */
export function committedArtifacts(repoRoot: string): string[] {
    const dir = resolve(repoRoot, CATALOGUE_DIR);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((f) => f.startsWith("catalogue-") && f.endsWith(".json"))
        .sort();
}

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function main() {
    const repoRoot = resolve(import.meta.dirname, "..");
    const check = process.argv.includes("--check");
    const build = buildCatalogue(repoRoot);
    const { merge } = build;

    if (merge.lossy.length > 0) {
        console.error(
            `${RED}✗ ${merge.lossy.length} relocation(s) lost data in the JSON round-trip:${RESET}\n` +
                merge.lossy.map((n) => `    ${n}`).join("\n") +
                "\n  A relocation is a MOVE. This is never baselined — the card is " +
                "not plain data and `isPlainData` failed to say so."
        );
        process.exit(1);
    }

    if (build.unjoinable > 0) {
        console.error(
            `${RED}✗ ${build.unjoinable} compiled \`ready\` row(s) have no card-index id/rarity${RESET}\n` +
                "  A row the join cannot complete is a card missing from the artifact AND a twin\n" +
                "  nobody checked. Run: bun run oracle:index"
        );
        process.exit(1);
    }

    const unbaselined = unbaselinedDivergences(build);
    if (unbaselined.length > 0) {
        console.error(
            `${RED}✗ ${unbaselined.length} card(s) diverge from their compiled twin (ADR 0114 §3):${RESET}\n` +
                unbaselined
                    .map(
                        (d) =>
                            `    ${d.card} — ${d.field}\n` +
                            `      hand-written: ${d.expected}\n` +
                            `      compiled:     ${d.actual}`
                    )
                    .join("\n") +
                "\n  Two authorities disagree; there is no silent winner. Decide which " +
                "side holds the defect, fix it, and if the answer is neither, add a row " +
                "to scripts/lib/catalogue-divergence-baseline.ts naming the ruling."
        );
        process.exit(1);
    }

    const summary =
        `${merge.rows.length} row(s): ${merge.relocated} relocated, ` +
        `${merge.compiledOnly} compiled-only (${merge.twins} twin(s) checked, ` +
        `${merge.divergences.length} baselined)\n` +
        `  ${merge.unrelocatable.length} hand-written definition(s) carry code and stay modules ` +
        `(${merge.withheld.length} compiled twin(s) withheld with them)\n` +
        `  ${build.unjoinable} ready row(s) unjoinable (a stop, not a tally — see above)`;

    const existing = committedArtifacts(repoRoot);
    const dir = resolve(repoRoot, CATALOGUE_DIR);
    const sourceHashPath = join(CATALOGUE_DIR, SOURCE_HASH_FILE);

    if (check) {
        const committed = join(CATALOGUE_DIR, build.fileName);
        if (existing.length !== 1 || existing[0] !== build.fileName) {
            console.error(
                `${RED}✗ catalogue artifact is stale${RESET}\n` +
                    `  expected exactly: ${committed}\n` +
                    `  found: ${existing.length === 0 ? "(nothing)" : existing.join(", ")}\n` +
                    `  Run: bun run catalogue:pack`
            );
            process.exit(1);
        }
        // IDENTITY FIRST, freshness second — the order is the diagnosis.
        //
        // Both orders go red on the same trees, and freshness is the wider
        // net (it also catches a tree where the two renderings agree with
        // each other and neither matches the source). But a stale rendering
        // fails BOTH, and whichever runs first is the message the reader
        // gets. Freshness can only ever say "this file is not what the tree
        // generates"; identity says WHICH CARD is now two definitions, which
        // is the fact ADR 0113 §2 is about — the server resolving a spell one
        // way and the Brain planning against another. Running freshness first
        // made the per-card diagnosis unreachable for the single-sided
        // mutation that is the whole failure mode (review of issue #3055).
        const drift = committedIdentityDrift(repoRoot);
        if (drift !== null) {
            console.error(
                `${RED}✗ the server-bundled definitions and the client artifact DIVERGE (ADR 0113 §2)${RESET}\n` +
                    `    ${describeIdentityDrift(drift)}\n` +
                    "  The server would resolve this card one way and the client's Brain plan\n" +
                    "  against another. Run: bun run catalogue:pack"
            );
            process.exit(1);
        }
        for (const [path, expected] of [
            [committed, build.bytes],
            [POOL_PATH, build.poolBytes],
            [sourceHashPath, build.sourceHashBytes],
        ] as const) {
            if (readCommitted(repoRoot, path) === expected) continue;
            console.error(
                `${RED}✗ ${path} is not what the tree generates${RESET}\n` +
                    `  Run: bun run catalogue:pack`
            );
            process.exit(1);
        }
        console.log(
            `${GREEN}✓${RESET} ${committed} is current — ${summary}\n` +
                `${DIM}  ${POOL_PATH} + ${sourceHashPath} agree with it, hash ${build.hash}${RESET}`
        );
        return;
    }

    mkdirSync(dir, { recursive: true });
    for (const stale of existing) {
        if (stale !== build.fileName) rmSync(join(dir, stale));
    }
    writeFileSync(join(dir, build.fileName), build.bytes, "utf-8");
    writeFileSync(resolve(repoRoot, POOL_PATH), build.poolBytes, "utf-8");
    writeFileSync(join(dir, SOURCE_HASH_FILE), build.sourceHashBytes, "utf-8");
    console.log(
        `${GREEN}✓${RESET} ${join(CATALOGUE_DIR, build.fileName)} ` +
            `(${(build.bytes.length / 1024).toFixed(0)} KB) — ${summary}\n` +
            `${GREEN}✓${RESET} ${POOL_PATH} ` +
            `(${(build.poolBytes.length / 1024).toFixed(0)} KB, ${build.merge.serverRows.length} row(s)) ` +
            `— the SAME rows, filtered (issue #3055)\n` +
            `${GREEN}✓${RESET} ${sourceHashPath} — ${build.hash}\n` +
            `${DIM}  provenance stays on the lockfile (ADR 0114 §2); the file name is the content hash${RESET}`
    );
}

if (import.meta.main) main();
