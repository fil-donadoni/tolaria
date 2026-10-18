/**
 * A game's card-data download, bounded by its own cards (issue #5618, PRD
 * #5602) — the pure half of `bun run check:game-download`: which emitted
 * assets are CARD DATA, which of them a game's Definition Manifest names, and
 * the verdict over what the browser actually fetched. No browser, no
 * deployment: `scripts/__tests__/game-download.test.ts` drives it over a fake
 * `dist/`.
 *
 * CARD DATA is what grows with the catalogue: the hand-written Set chunks
 * (`card-set-<code>-<hash>.js`, issue #5615), the compiled shards
 * (`compiled-shard-<code>-<hash>.json`, issue #5616), the compiled
 * Definition Index, the shard dictionary — and the two catalogue-wide
 * assets no game may fetch: the whole compiled corpus (`packed-corpus-*`,
 * before issue #5616) and the Full Catalogue the deck builder searches
 * (`full-catalogue-*.gz`, `src/lib/fullCatalogue.ts`), whose URL a chunk of
 * the game route's closure names. The app shell, the game route and the
 * engine are code — `check:bundle` bounds those.
 *
 * THE BUDGET IS THE MANIFEST'S, never the catalogue's: the gzip bytes of the
 * assets the game's Manifest names — each hand-written Set its cards sit in,
 * with the Set chunks those import statically (`drk` reads a `leg` helper),
 * each compiled shard, and the dictionary every game gate awaits. A game that
 * fetches anything else (the whole catalogue, the compiled index, a Set none
 * of its cards is in) goes over it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
    SET_CHUNK_PREFIX,
    WHOLE_CORPUS_ASSET,
    reachableChunks,
} from "./asset-graph";

/** One emitted hand-written Set chunk: `card-set-<code>-<hash>.js`. A Set
 *  code never carries a `-`, so the first `-` after it starts the hash. */
const SET_CHUNK = /^card-set-([a-z0-9]+)-[\w-]+\.js$/;
/** One emitted compiled shard: `compiled-shard-<code>-<12 hex>.json`. */
const COMPILED_SHARD = /^compiled-shard-([a-z0-9]+)-[0-9a-f]{12}\.json$/;
/** The compiled Definition Index (`compiled-index-<12 hex>.json`) — every
 *  compiled card's name and shard: catalogue-wide, so no game route needs it
 *  when its Manifest names every shard. */
const COMPILED_INDEX = /^compiled-index-[0-9a-f]{12}\.json$/;
/** The shard dictionary (`compiled-dictionary-<12 hex>.json`) the game gate
 *  awaits before any shard (`src/lib/catalogueGateMode.ts`). */
const COMPILED_DICTIONARY = /^compiled-dictionary-[0-9a-f]{12}\.json$/;
/** The Full Catalogue: `full-catalogue-<hash>.json-<hash>.gz`. */
const FULL_CATALOGUE = /^full-catalogue-[\w.-]+\.gz$/;

export type CardDataKind =
    | "set"
    | "shard"
    | "index"
    | "dictionary"
    | "catalogue";

/** What kind of card data an emitted asset is, or `null` for code. */
export function cardDataKind(asset: string): CardDataKind | null {
    if (SET_CHUNK.test(asset)) return "set";
    if (COMPILED_SHARD.test(asset)) return "shard";
    if (COMPILED_INDEX.test(asset)) return "index";
    if (COMPILED_DICTIONARY.test(asset)) return "dictionary";
    if (FULL_CATALOGUE.test(asset) || WHOLE_CORPUS_ASSET.test(asset)) {
        return "catalogue";
    }
    return null;
}

/** One entry of a seat's Definition Manifest
 *  (`gameReads.getDefinitionManifest`). */
export interface ManifestEntry {
    definitionId: string;
    setCode: string;
}

/** The hand-written Definition Index's id → Set code, read the way the
 *  client's `set-modules.browser.ts` reads it. */
export function handWrittenSetCodes(indexJson: string): Map<string, string> {
    const raw = JSON.parse(indexJson) as { entries?: string[][] };
    const out = new Map<string, string>();
    for (const [id, , setCode] of raw.entries ?? []) {
        if (id !== undefined && setCode !== undefined) out.set(id, setCode);
    }
    return out;
}

/** The gzip size of every card-data asset in `distDir/assets`. */
export function cardDataSizes(distDir: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const asset of readdirSync(join(distDir, "assets"))) {
        if (cardDataKind(asset) === null) continue;
        out.set(
            asset,
            gzipSync(readFileSync(join(distDir, "assets", asset))).length
        );
    }
    return out;
}

export interface ManifestBudget {
    /** The card-data assets the Manifest names, sorted. */
    assets: string[];
    /** Their gzip bytes together — the budget. */
    gzipBytes: number;
}

/**
 * The card-data assets a game whose seats' Manifests are `entries` may
 * download, and their gzip bytes. An entry is located the way the client's
 * `entryShardKey` locates it: a card the hand-written index knows is its
 * Set's chunk; any other is the compiled shard its `setCode` names, when the
 * build emits one. An entry with neither adds nothing — the client serves no
 * shard for it either.
 */
export function manifestBudget(
    distDir: string,
    entries: readonly ManifestEntry[],
    handWritten: ReadonlyMap<string, string>,
    sizes: ReadonlyMap<string, number> = cardDataSizes(distDir)
): ManifestBudget {
    const setChunkOf = new Map<string, string>();
    const shardOf = new Map<string, string>();
    const assets = new Set<string>();
    for (const asset of sizes.keys()) {
        const set = SET_CHUNK.exec(asset);
        if (set) setChunkOf.set(set[1]!, asset);
        const shard = COMPILED_SHARD.exec(asset);
        if (shard) shardOf.set(shard[1]!, asset);
        if (COMPILED_DICTIONARY.test(asset)) assets.add(asset);
    }
    const setRoots = new Set<string>();
    for (const entry of entries) {
        const set = handWritten.get(entry.definitionId);
        if (set !== undefined) {
            const chunk = setChunkOf.get(set);
            if (chunk !== undefined) setRoots.add(chunk);
            continue;
        }
        const shard = shardOf.get(entry.setCode);
        if (shard !== undefined) assets.add(shard);
    }
    for (const chunk of reachableChunks(distDir, [...setRoots])) {
        if (chunk.startsWith(SET_CHUNK_PREFIX)) assets.add(chunk);
    }
    const sorted = [...assets].sort();
    return {
        assets: sorted,
        gzipBytes: sorted.reduce((n, a) => n + (sizes.get(a) ?? 0), 0),
    };
}

export interface GameDownload {
    /** What the run is called on its report line (`solo`, `bot`). */
    game: string;
    /** The card-data assets the browser fetched, page and worker, each once. */
    fetched: string[];
    budget: ManifestBudget;
}

export interface GameDownloadReport {
    game: string;
    fetchedGzipBytes: number;
    budgetGzipBytes: number;
    /** Fetched card data the Manifest does not name, sorted. */
    unnamed: string[];
    /** Why the game fails, or empty. */
    failures: string[];
}

/** The verdict over one game's download. It fails over budget, and — the
 *  vacuity guard — when the game fetched no card data at all (the request
 *  listener saw nothing, or the board rendered without its cards). */
export function judgeGameDownload(
    run: GameDownload,
    sizes: ReadonlyMap<string, number>
): GameDownloadReport {
    const fetched = [...new Set(run.fetched)].filter(
        (a) => cardDataKind(a) !== null
    );
    const named = new Set(run.budget.assets);
    const unnamed = fetched.filter((a) => !named.has(a)).sort();
    const fetchedGzipBytes = fetched.reduce(
        (n, a) => n + (sizes.get(a) ?? 0),
        0
    );
    const failures: string[] = [];
    if (fetched.length === 0) {
        failures.push(
            "no card data fetched at all — the measurement saw nothing, so it proves nothing"
        );
    }
    if (fetchedGzipBytes > run.budget.gzipBytes) {
        const shown = unnamed.slice(0, 8).join(", ");
        failures.push(
            `${fetchedGzipBytes} B gzip of card data > the Manifest's ${run.budget.gzipBytes} B — ` +
                `${unnamed.length} asset(s) no Manifest entry names: ${shown}${unnamed.length > 8 ? ", …" : ""}`
        );
    }
    return {
        game: run.game,
        fetchedGzipBytes,
        budgetGzipBytes: run.budget.gzipBytes,
        unnamed,
        failures,
    };
}

/** The gzip bytes of every Set, shard and compiled index the build emits —
 *  what a whole-catalogue surface installs (`installAllShards`), and what a
 *  game paid before PRD #5602; printed beside each game for scale. */
export function catalogueGzipBytes(sizes: ReadonlyMap<string, number>): number {
    let n = 0;
    for (const [asset, bytes] of sizes) {
        if (cardDataKind(asset) !== "catalogue") n += bytes;
    }
    return n;
}
