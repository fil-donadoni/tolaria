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
 *   - `data/catalogue/catalogue-<hash>.json` — every merged row, minified,
 *     content-addressed by its own bytes: the anchor every other rendering
 *     is compared with. It WAS the client asset until issue #4861; the client
 *     now fetches the packed corpus below;
 *   - `data/catalogue/source-hash.json` — the ONE source hash, which the
 *     server bundles through `convex/cards/compiledCatalogue.ts` and the
 *     client carries in the artifact's file NAME. Two independently written
 *     records of one generation, so taking one side of a merge is visible;
 *   - `data/catalogue/packed-corpus.json` — the SERVER rendering (issue
 *     #4164, ADR 0113 Amendment III): `merge.rows` FILTERED
 *     (`merge.serverRows`), never a second join, deflated in blocks against
 *     one shared dictionary, with its first-id and name indexes, carrying the
 *     same source hash (`scripts/lib/packed-corpus.ts`). The server bundles
 *     it and reads a block on first request — its ONLY rendering of the
 *     compiled rows since issue #4168 retired the pretty-printed literal pool
 *     (`data/oracle-compiled-pool.json`, itself the heir of the retired
 *     `scripts/oracle-pool.ts`, issue #3055); the CLIENT fetches the same
 *     file as its catalogue (issue #4861). It also carries the COMPILED
 *     section of the Definition Index (issue #4856);
 *   - `data/catalogue/definition-index.json` — the HAND-WRITTEN section of
 *     the Definition Index (issue #4856, `scripts/lib/definition-index.ts`):
 *     every hand-written definition's id, name, Set and export, plus the
 *     lookups the catalogue reads at load instead of walking the modules;
 *   - `data/catalogue/search-index.json` — the deck-builder search index
 *     (issue #4861, `scripts/lib/search-index.ts`): one row per catalogue
 *     card, so the client searches the whole catalogue without decoding it.
 *
 * `--check` writes nothing. It compares the two COMMITTED renderings against
 * each other first — the packed corpus DECODED, every block, against the
 * anchor's shared rows, naming the first card that differs
 * (`packedCorpusDrift`, the decode-equality guard) — and only then compares
 * every file against a fresh regeneration. Identity first because a stale rendering fails both and
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
import {
    getAllRawCards,
    walkHandWrittenDefinitions,
} from "../convex/cards/catalogue";
import type { CardDefinition } from "../convex/cards/types";
import {
    CATALOGUE_DIR,
    SOURCE_HASH_FILE,
    artifactFileName,
    contentHash,
    mergeCatalogue,
    serializeCatalogue,
    serializeSourceHash,
    type CompiledCard,
    type HandWrittenCard,
    type MergeResult,
} from "./lib/catalogue-merge";
import {
    PACKED_CORPUS_PATH,
    packCorpus,
    packedCorpusDrift,
    serializePackedCorpus,
    type PackedCorpus,
} from "./lib/packed-corpus";
import {
    DEFINITION_INDEX_PATH,
    buildHandWrittenIndex,
    serializeDefinitionIndex,
} from "./lib/definition-index";
import { SEARCH_INDEX_PATH, buildSearchIndexBytes } from "./lib/search-index";
import {
    BASELINE_KEYS,
    baselineKey,
} from "./lib/catalogue-divergence-baseline";

type Rarity = "common" | "uncommon" | "rare" | "mythic";

interface CardIndexEntry {
    name: string;
    oracleId: string;
    firstPrintId: string;
    /** The Set of `firstPrintId` — what the client's Set filter and the
     *  allowed-Set Formats read for a compiled card (issue #4363). */
    firstPrintSet?: string;
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
    /** The source hash sidecar's bytes — `data/catalogue/source-hash.json`. */
    readonly sourceHashBytes: string;
    /** The SERVER rendering's bytes, packed — {@link PACKED_CORPUS_PATH}. */
    readonly packedBytes: string;
    /** The hand-written Definition Index's bytes — {@link DEFINITION_INDEX_PATH}. */
    readonly definitionIndexBytes: string;
    /** The deck-builder search index's bytes — {@link SEARCH_INDEX_PATH}. */
    readonly searchIndexBytes: string;
    readonly hash: string;
    readonly fileName: string;
    /** `ready` rows the join could not resolve an `id`/`rarity`/`setCode` for. */
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
        // Same stop as a missing rarity: a compiled row shipped with no Set
        // is the bug this field exists to close (issue #4363).
        if (!entry.firstPrintSet) {
            unjoinable++;
            continue;
        }
        compiled.push({
            oracleId: row.oracleId,
            definition: {
                ...row.definition,
                id: entry.firstPrintId,
                rarity,
                setCode: entry.firstPrintSet,
            } as CardDefinition,
        });
    }

    const merge = mergeCatalogue(handWritten, compiled);
    const walk = walkHandWrittenDefinitions();
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
        sourceHashBytes: serializeSourceHash(hash),
        packedBytes: serializePackedCorpus(packCorpus(merge.serverRows, hash)),
        definitionIndexBytes: serializeDefinitionIndex(
            buildHandWrittenIndex(walk)
        ),
        searchIndexBytes: buildSearchIndexBytes(walk, merge.serverRows),
        hash,
        fileName: artifactFileName(hash),
        unjoinable,
    };
}

const readCommitted = (repoRoot: string, path: string): string | null => {
    const full = resolve(repoRoot, path);
    return existsSync(full) ? readFileSync(full, "utf-8") : null;
};

/**
 * The client's rendering of the SHARED definitions: the artifact's rows minus
 * the relocated hand-written ones.
 *
 * This is `excludeHandWritten` applied to the merged artifact — it carries the
 * hand-written rows too, and the runtime serves those from the modules the
 * engine runs (`convex/cards/compiledCatalogue.ts`). So what is left is
 * exactly the population the packed corpus holds — the one the eager client
 * used to register before issue #4861.
 */
export function sharedClientRows(
    rows: readonly CardDefinition[]
): CardDefinition[] {
    const handWrittenIds = new Set(getAllRawCards().map((c) => c.id));
    return rows.filter((r) => !handWrittenIds.has(r.id));
}

/**
 * Compare the two COMMITTED renderings — the question ADR 0113 §2 poses,
 * asked of the bytes on disk rather than of a regeneration (issue #3055):
 * does the packed server corpus decode to exactly the anchor's shared rows,
 * under the same source hash, with true indexes (issue #4164)? One line naming
 * the first differing card, or `null`.
 *
 * This decode-equality guard is the standing proof that the server's rows are
 * the catalogue's (issue #4168): it inflates every block, where a request
 * inflates one.
 *
 * `null` when a file is missing: that is the freshness check's failure to
 * report, and reporting it twice would name the wrong remedy.
 */
export function committedPackedDrift(repoRoot: string): string | null {
    const packed = readCommitted(repoRoot, PACKED_CORPUS_PATH);
    const artifacts = committedArtifacts(repoRoot);
    if (packed === null || artifacts.length !== 1) return null;
    const artifact = readCommitted(
        repoRoot,
        join(CATALOGUE_DIR, artifacts[0]!)
    );
    if (artifact === null) return null;
    const hash = artifacts[0]!.slice("catalogue-".length, -".json".length);
    return packedCorpusDrift(
        JSON.parse(packed) as PackedCorpus,
        sharedClientRows(JSON.parse(artifact) as CardDefinition[]),
        hash
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
            `${RED}✗ ${build.unjoinable} compiled \`ready\` row(s) have no card-index id/rarity/set${RESET}\n` +
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
        const packedDrift = committedPackedDrift(repoRoot);
        if (packedDrift !== null) {
            console.error(
                `${RED}✗ the server-bundled packed corpus and the catalogue artifact DIVERGE (ADR 0113 §2)${RESET}\n` +
                    `    ${packedDrift}\n` +
                    "  The server would resolve this card one way and the client's Brain plan\n" +
                    "  against another. Run: bun run catalogue:pack"
            );
            process.exit(1);
        }
        for (const [path, expected] of [
            [committed, build.bytes],
            [sourceHashPath, build.sourceHashBytes],
            [PACKED_CORPUS_PATH, build.packedBytes],
            [DEFINITION_INDEX_PATH, build.definitionIndexBytes],
            [SEARCH_INDEX_PATH, build.searchIndexBytes],
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
                `${DIM}  ${PACKED_CORPUS_PATH} + ${DEFINITION_INDEX_PATH} + ${SEARCH_INDEX_PATH} + ${sourceHashPath} agree with it, hash ${build.hash}${RESET}`
        );
        return;
    }

    mkdirSync(dir, { recursive: true });
    for (const stale of existing) {
        if (stale !== build.fileName) rmSync(join(dir, stale));
    }
    writeFileSync(join(dir, build.fileName), build.bytes, "utf-8");
    writeFileSync(join(dir, SOURCE_HASH_FILE), build.sourceHashBytes, "utf-8");
    writeFileSync(
        resolve(repoRoot, PACKED_CORPUS_PATH),
        build.packedBytes,
        "utf-8"
    );
    writeFileSync(
        resolve(repoRoot, DEFINITION_INDEX_PATH),
        build.definitionIndexBytes,
        "utf-8"
    );
    writeFileSync(
        resolve(repoRoot, SEARCH_INDEX_PATH),
        build.searchIndexBytes,
        "utf-8"
    );
    console.log(
        `${GREEN}✓${RESET} ${join(CATALOGUE_DIR, build.fileName)} ` +
            `(${(build.bytes.length / 1024).toFixed(0)} KB) — ${summary}\n` +
            `${GREEN}✓${RESET} ${PACKED_CORPUS_PATH} ` +
            `(${build.packedBytes.length} B, ${build.merge.serverRows.length} row(s), ${(build.packedBytes.length / Math.max(1, build.merge.serverRows.length)).toFixed(0)} B/row) ` +
            `— the SAME rows, filtered and packed (issues #3055, #4164)\n` +
            `${GREEN}✓${RESET} ${DEFINITION_INDEX_PATH} ` +
            `(${(build.definitionIndexBytes.length / 1024).toFixed(0)} KB) — the hand-written Definition Index (issue #4856)\n` +
            `${GREEN}✓${RESET} ${SEARCH_INDEX_PATH} ` +
            `(${(build.searchIndexBytes.length / 1024).toFixed(0)} KB) — the deck-builder search index (issue #4861)\n` +
            `${GREEN}✓${RESET} ${sourceHashPath} — ${build.hash}\n` +
            `${DIM}  provenance stays on the lockfile (ADR 0114 §2); the file name is the content hash${RESET}`
    );
}

if (import.meta.main) main();
