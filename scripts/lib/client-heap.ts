/**
 * Heap of the CLIENT catalogue for one game load, in the page and in the Bot
 * worker separately (issue #4861, PRD #4849, ADR 0113 Amendment IV) — the
 * client half of the invariant `scripts/lib/convex-heap.ts` measures for the
 * server: what a game costs grows with the cards of the game, never with the
 * catalogue.
 *
 * Method — the server's (`docs/research/convex-server-scale-2026-09-29.md`
 * § Method), applied to the browser's module graph:
 *
 *   - each context's entry is bundled by esbuild with the BROWSER build's
 *     substitutions (`vite.config.ts`): `./compiledPool` → the browser stub,
 *     `convex/formats.ts`'s `./cards` → the late-bound resolver,
 *     `@convex/cards` → `convex/cards/client.ts`, and every `?url` asset
 *     import → a placeholder URL;
 *   - the probe stubs `fetch` with the packed corpus — the committed one, or
 *     a SYNTHETIC one at the target scale, packed by the generator's own
 *     `packCorpus` from the committed rows cycled to N with fresh UUID ids and
 *     unique names (the tree is never edited);
 *   - in a fresh `node --expose-gc`, the heap after `gc()` is read after the
 *     import, after `hydrateCatalogue()` and the game's `getDefinition`s,
 *     and the CATALOGUE figure is the difference — what the corpus and the
 *     game's decoded cards hold, the code excluded. The minimum of several
 *     runs, since noise only ever adds.
 *
 * The DECK BUILDER is measured the same way (issue #5125): it holds no
 * catalogue, but its search index (`src/lib/searchIndex.ts`) is resident for
 * the life of the page. Its probe stubs `fetch` with the committed
 * `search-index.json` — or a synthetic one, its rows cycled to N with fresh
 * ids and unique names, written out and parsed back so no string is shared
 * that a real fetch would not share — and reads the heap the loaded index
 * holds.
 *
 * Node's V8 is a proxy for a browser's; read the figures as relative, the
 * absolute ones as approximately right.
 */
import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildDefine } from "./build-define";
import {
    PACKED_CORPUS_PATH,
    packCorpus,
    serializePackedCorpus,
    unpackCorpus,
    type PackedCorpus,
} from "./packed-corpus";
import type { SearchIndexWireRow } from "../../convex/cards/searchIndex";
import type { CardDefinition } from "../../convex/cards/types";
import { SEARCH_INDEX_PATH } from "./search-index";

const MIB = 1024 * 1024;

/** Compiled rows at the scale target (PRD #4849). */
export const TARGET_CORPUS_ROWS = 35_000;

/** The budget the arming ticket enforces, per context (PRD #4849's target). */
export const CLIENT_CATALOGUE_BUDGET_BYTES = 15 * MIB;

/** Runs per measurement; the minimum is reported. */
export const CLIENT_HEAP_RUNS = 3;

/** Distinct compiled cards a game resolves: two decks' worth of names. */
export const GAME_COMPILED_CARDS = 50;

/** The two module graphs a game against the Bot loads the catalogue into. */
export const CLIENT_CONTEXTS = {
    /** The page: the catalogue gate's hydration. */
    main: "src/lib/catalogueArtifact.ts",
    /** The Bot worker: its request handler beside the same hydration. */
    worker: "src/lib/ai/brain-request.ts",
} as const;

export type ClientContext = keyof typeof CLIENT_CONTEXTS;

/** The deck builder's search-index loader (issue #5125). */
export const SEARCH_INDEX_LOADER = "src/lib/searchIndex.ts";

export interface ClientHeap {
    context: ClientContext;
    rows: number;
    /** The module graph's own evaluation. */
    importBytes: number;
    /** The corpus resident plus the game's decoded cards. */
    catalogueBytes: number;
    /** Blocks the game inflated. */
    inflations: number;
}

/** `rows` compiled rows: the committed ones, cycled past their count with a
 *  fresh UUID-shaped id (the packed lookup refuses any other id) and a unique
 *  name (the catalogue indexes both), sorted by id as the generator sorts. */
export function syntheticRows(
    base: readonly CardDefinition[],
    rows: number
): CardDefinition[] {
    const out: CardDefinition[] = [];
    for (let i = 0; i < rows; i++) {
        const row = base[i % base.length]!;
        if (i < base.length) {
            out.push(row);
            continue;
        }
        const tail = i.toString(16).padStart(12, "0");
        out.push({
            ...row,
            id: `${row.id.slice(0, 24)}${tail}`,
            name: `${row.name} s${i}`,
        });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The committed compiled rows, decoded from the packed corpus (the server's
 *  only rendering since issue #4168 retired the literal pool). */
export function committedRows(repoRoot: string): CardDefinition[] {
    return unpackCorpus(
        JSON.parse(
            readFileSync(join(repoRoot, PACKED_CORPUS_PATH), "utf8")
        ) as PackedCorpus
    );
}

/** The browser build's substitutions, as one esbuild plugin. */
function browserGraph(repoRoot: string): esbuild.Plugin {
    const src = join(repoRoot, "src");
    const convex = join(repoRoot, "convex");
    return {
        name: "tolaria-browser-graph",
        setup(build) {
            build.onResolve({ filter: /\?url$/ }, (args) => ({
                path: args.path,
                namespace: "asset-url",
            }));
            build.onLoad({ filter: /.*/, namespace: "asset-url" }, (args) => ({
                contents: `export default ${JSON.stringify(`/assets/${args.path}`)};`,
                loader: "js",
            }));
            build.onResolve({ filter: /^\.\/compiledPool$/ }, () => ({
                path: join(src, "lib/catalogue/compiled-pool.browser.ts"),
            }));
            build.onResolve({ filter: /^\.\/cards$/ }, (args) =>
                args.importer
                    .replaceAll("\\", "/")
                    .endsWith("/convex/formats.ts")
                    ? {
                          path: join(
                              src,
                              "lib/catalogue/deck-card-meta.browser.ts"
                          ),
                      }
                    : undefined
            );
            build.onResolve({ filter: /^@convex\/cards$/ }, () => ({
                path: join(convex, "cards/client.ts"),
            }));
            build.onResolve({ filter: /^(~|@|@convex)\// }, async (args) => {
                const [prefix, ...rest] = args.path.split("/");
                const root = prefix === "@convex" ? convex : src;
                return build.resolve(`./${rest.join("/")}`, {
                    resolveDir: root,
                    kind: args.kind,
                });
            });
        },
    };
}

/** The probe each context runs: import, hydrate, resolve the game. */
function probeSource(
    repoRoot: string,
    context: ClientContext,
    gameIds: readonly string[]
): string {
    const entry = join(repoRoot, CLIENT_CONTEXTS[context]);
    const artifact = join(repoRoot, "src/lib/catalogueArtifact.ts");
    return `
import ${JSON.stringify(entry)};
import { hydrateCatalogue } from ${JSON.stringify(artifact)};
import { getDefinition } from ${JSON.stringify(join(repoRoot, "convex/cards/registry.ts"))};
import { packedCorpusInflations } from ${JSON.stringify(join(repoRoot, "convex/cards/catalogue.ts"))};
import { readFileSync } from "node:fs";
export async function run(corpusFile) {
    globalThis.fetch = async () => ({
        ok: true,
        json: async () => JSON.parse(readFileSync(corpusFile, "utf8")),
    });
    gc();
    const before = process.memoryUsage().heapUsed;
    await hydrateCatalogue();
    for (const id of ${JSON.stringify(gameIds)}) getDefinition(id);
    gc();
    return {
        catalogueBytes: process.memoryUsage().heapUsed - before,
        inflations: packedCorpusInflations(),
    };
}
`;
}

/** The child's program: the import's heap, then the probe's. A file, not
 *  `node -e` (see `convex-heap.ts`'s `PROBE`). */
const RUNNER = `
const [bundle, corpus] = process.argv.slice(2);
gc();
const start = process.memoryUsage().heapUsed;
const probe = await import(bundle);
gc();
const importBytes = process.memoryUsage().heapUsed - start;
const result = await probe.run(corpus);
console.log(JSON.stringify({ importBytes, ...result }));
`;

/** A game: {@link GAME_COMPILED_CARDS} compiled ids spread across the corpus,
 *  so each one lands in its own block — the worst case for a game's decode. */
export function gameIds(rows: readonly CardDefinition[]): string[] {
    const stride = Math.max(1, Math.floor(rows.length / GAME_COMPILED_CARDS));
    return rows
        .filter((_, i) => i % stride === 0)
        .slice(0, GAME_COMPILED_CARDS)
        .map((r) => r.id);
}

/** The heap of each context's game load over a corpus of `rows` rows. */
export async function measureClientHeap(
    repoRoot: string,
    rows: number,
    contexts: readonly ClientContext[] = ["main", "worker"],
    runs = CLIENT_HEAP_RUNS
): Promise<ClientHeap[]> {
    const root = resolve(repoRoot);
    const base = committedRows(root);
    const corpusRows = rows === base.length ? base : syntheticRows(base, rows);
    const game = gameIds(corpusRows);
    const dir = mkdtempSync(join(tmpdir(), "client-heap-"));
    try {
        const corpus = join(dir, "packed-corpus.json");
        writeFileSync(
            corpus,
            serializePackedCorpus(packCorpus(corpusRows, "synthetic"))
        );
        const runner = join(dir, "runner.mjs");
        writeFileSync(runner, RUNNER);
        const report: ClientHeap[] = [];
        for (const context of contexts) {
            const bundle = join(dir, `${context}.mjs`);
            await bundleProbe(root, probeSource(root, context, game), bundle);
            let best: ClientHeap | null = null;
            for (let i = 0; i < runs; i++) {
                const out = runProbe(runner, bundle, corpus, context) as {
                    importBytes: number;
                    catalogueBytes: number;
                    inflations: number;
                };
                const run: ClientHeap = { context, rows, ...out };
                if (best === null || run.catalogueBytes < best.catalogueBytes)
                    best = run;
            }
            report.push(best!);
        }
        return report;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** The deck builder's resident search index over `rows` cards. */
export interface SearchIndexHeap {
    rows: number;
    /** The loader's module graph's own evaluation. */
    importBytes: number;
    /** The loaded index, as the deck builder holds it. */
    indexBytes: number;
}

/** The committed search-index rows, as the asset carries them. */
export function committedSearchIndexWire(
    repoRoot: string
): SearchIndexWireRow[] {
    return JSON.parse(
        readFileSync(join(repoRoot, SEARCH_INDEX_PATH), "utf8")
    ) as SearchIndexWireRow[];
}

/** `rows` wire rows: the committed ones, cycled past their count with a fresh
 *  UUID-shaped id and a unique name — {@link syntheticRows}'s scheme. */
export function syntheticSearchIndexWire(
    base: readonly SearchIndexWireRow[],
    rows: number
): SearchIndexWireRow[] {
    const out: SearchIndexWireRow[] = [];
    for (let i = 0; i < rows; i++) {
        const row = base[i % base.length]!;
        if (i < base.length) {
            out.push(row);
            continue;
        }
        const [cardId, name, ...rest] = row;
        const tail = i.toString(16).padStart(12, "0");
        out.push([`${cardId.slice(0, 24)}${tail}`, `${name} s${i}`, ...rest]);
    }
    return out;
}

/** The deck-builder probe: import the loader, load the index, hold it. */
function searchIndexProbeSource(repoRoot: string): string {
    return `
import { loadSearchIndex } from ${JSON.stringify(join(repoRoot, SEARCH_INDEX_LOADER))};
import { readFileSync } from "node:fs";
export async function run(indexFile) {
    globalThis.fetch = async () => ({
        ok: true,
        json: async () => JSON.parse(readFileSync(indexFile, "utf8")),
    });
    gc();
    const before = process.memoryUsage().heapUsed;
    globalThis.heldSearchIndex = await loadSearchIndex();
    gc();
    return { indexBytes: process.memoryUsage().heapUsed - before };
}
`;
}

/** The heap of the deck builder's loaded search index over `rows` cards. */
export async function measureSearchIndexHeap(
    repoRoot: string,
    rows: number,
    runs = CLIENT_HEAP_RUNS
): Promise<SearchIndexHeap> {
    const root = resolve(repoRoot);
    const base = committedSearchIndexWire(root);
    const wire =
        rows === base.length ? base : syntheticSearchIndexWire(base, rows);
    const dir = mkdtempSync(join(tmpdir(), "client-heap-"));
    try {
        const indexFile = join(dir, "search-index.json");
        writeFileSync(indexFile, JSON.stringify(wire));
        const runner = join(dir, "runner.mjs");
        writeFileSync(runner, RUNNER);
        const bundle = join(dir, "deck-builder.mjs");
        await bundleProbe(root, searchIndexProbeSource(root), bundle);
        let best: SearchIndexHeap | null = null;
        for (let i = 0; i < runs; i++) {
            const out = runProbe(runner, bundle, indexFile, "deck-builder") as {
                importBytes: number;
                indexBytes: number;
            };
            if (best === null || out.indexBytes < best.indexBytes)
                best = { rows, ...out };
        }
        return best!;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** Bundle one probe with the browser build's substitutions. */
async function bundleProbe(
    root: string,
    contents: string,
    outfile: string
): Promise<void> {
    await esbuild.build({
        stdin: { contents, resolveDir: root, loader: "js" },
        bundle: true,
        format: "esm",
        platform: "node",
        outfile,
        define: {
            ...buildDefine(),
            "import.meta.env": JSON.stringify({
                DEV: false,
                PROD: true,
                MODE: "production",
            }),
        },
        plugins: [browserGraph(root)],
        logLevel: "silent",
    });
}

/** One probe run in a fresh `node --expose-gc`: its last stdout line. */
function runProbe(
    runner: string,
    bundle: string,
    data: string,
    label: string
): unknown {
    const r = spawnSync("node", ["--expose-gc", runner, bundle, data], {
        encoding: "utf8",
        timeout: 300_000,
    });
    if (r.status !== 0) {
        throw new Error(
            `client heap probe failed (${label}, status ${r.status}): ${r.stderr.slice(0, 600)}`
        );
    }
    return JSON.parse(r.stdout.trim().split("\n").pop()!) as unknown;
}

/** One `WARN` line per context over the client budget. */
export function clientHeapWarnings(report: readonly ClientHeap[]): string[] {
    return report
        .filter((h) => h.catalogueBytes > CLIENT_CATALOGUE_BUDGET_BYTES)
        .map(
            (h) =>
                `${h.context}: ${(h.catalogueBytes / MIB).toFixed(1)} MiB of catalogue at ` +
                `${h.rows.toLocaleString("en-US")} rows > ` +
                `${(CLIENT_CATALOGUE_BUDGET_BYTES / MIB).toFixed(0)} MiB budget`
        );
}
