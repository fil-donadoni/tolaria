import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
    CORPUS_PIN_REL,
    corpusCacheSha,
    corpusUsable,
    pinnedSha,
    realCorpusSeedDeps,
    seedPinnedCorpus,
    type CorpusSeedDeps,
} from "../lib/corpus-cache";
import { CORPUS_CACHE_REL } from "../lib/generated-artifacts";
import { readCorpusFile } from "../oracle-corpus";

// Issue #6381: the gitignored Card Corpus cache moves between checkouts by
// copy, and a cache is only usable by a tree whose pin names its bytes.

const OLD = JSON.stringify([{ oracleId: "a", name: "Old" }]);
const NEW = JSON.stringify([{ oracleId: "a", name: "New" }]);
const shaOf = (payload: string): string =>
    createHash("sha256").update(payload).digest("hex");

function writeCache(root: string, payload: string): void {
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(join(root, CORPUS_CACHE_REL), gzipSync(payload));
}

function writePin(root: string, payload: string): void {
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(
        join(root, CORPUS_PIN_REL),
        JSON.stringify({ sha256: shaOf(payload) })
    );
}

const cacheText = (root: string): string =>
    readCorpusFile(join(root, CORPUS_CACHE_REL), null)[0]!.name;

describe("corpus cache against its pin", () => {
    let root: string;
    let primary: string;
    let wt: string;
    let fetches: number;
    const deps = (fetchWrites: string | null): CorpusSeedDeps => ({
        ...realCorpusSeedDeps,
        fetchPinned: (dir) => {
            fetches += 1;
            if (fetchWrites === null) return false;
            writeCache(dir, fetchWrites);
            return true;
        },
    });

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), "tolaria-corpus-cache-"));
        primary = join(root, "primary");
        wt = join(root, "wt");
        fetches = 0;
    });
    afterEach(() =>
        rmSync(root, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        })
    );

    it("hashes the reduced payload, the bytes a pin's sha256 names", () => {
        writeCache(wt, NEW);
        expect(corpusCacheSha(join(wt, CORPUS_CACHE_REL))).toBe(shaOf(NEW));
        writePin(wt, NEW);
        expect(pinnedSha(wt)).toBe(shaOf(NEW));
        expect(pinnedSha(primary)).toBeNull();
    });

    it("refuses to read a cache that is not the pin's, naming both hashes", () => {
        writeCache(wt, OLD);
        const path = join(wt, CORPUS_CACHE_REL);
        expect(() => readCorpusFile(path, { sha256: shaOf(NEW) })).toThrow(
            new RegExp(`${shaOf(OLD)}[\\s\\S]*${shaOf(NEW)}`)
        );
        expect(readCorpusFile(path, { sha256: shaOf(OLD) })).toHaveLength(1);
        expect(readCorpusFile(path, null)).toHaveLength(1);
    });

    it("keeps a local cache that matches the pin", () => {
        writePin(wt, NEW);
        writeCache(wt, NEW);
        writeCache(primary, OLD);
        const seed = seedPinnedCorpus(wt, primary, pinnedSha(wt), deps(NEW));
        expect(seed).toEqual({ ok: true, how: "kept" });
        expect(fetches).toBe(0);
    });

    it("copies the primary's cache only when it matches THIS tree's pin", () => {
        writePin(wt, OLD);
        writeCache(primary, OLD);
        const seed = seedPinnedCorpus(wt, primary, pinnedSha(wt), deps(NEW));
        expect(seed).toEqual({ ok: true, how: "copied" });
        expect(fetches).toBe(0);
        expect(cacheText(wt)).toBe("Old");
    });

    it("fetches the pinned bulk when the primary's cache is on another pin (a re-pin just landed)", () => {
        writePin(wt, NEW);
        writeCache(primary, OLD);
        const seed = seedPinnedCorpus(wt, primary, pinnedSha(wt), deps(NEW));
        expect(seed).toEqual({ ok: true, how: "fetched" });
        expect(fetches).toBe(1);
        expect(cacheText(wt)).toBe("New");
    });

    it("replaces a stale local cache rather than keeping it", () => {
        writePin(wt, NEW);
        writeCache(wt, OLD);
        writeCache(primary, NEW);
        const seed = seedPinnedCorpus(wt, primary, pinnedSha(wt), deps(null));
        expect(seed).toEqual({ ok: true, how: "copied" });
        expect(cacheText(wt)).toBe("New");
    });

    it("fails when nothing matching can be had — never falls back to a mismatched file", () => {
        writePin(wt, NEW);
        writeCache(wt, OLD);
        writeCache(primary, OLD);
        const seed = seedPinnedCorpus(wt, primary, pinnedSha(wt), deps(null));
        expect(seed.ok).toBe(false);
        // A fetch that "succeeds" with the wrong bulk is a failure too.
        const wrong = seedPinnedCorpus(wt, primary, pinnedSha(wt), deps(OLD));
        expect(wrong.ok).toBe(false);
    });

    it("treats a corrupt (truncated) cache as unusable, never a throw", () => {
        writePin(wt, NEW);
        mkdirSync(join(wt, "data"), { recursive: true });
        writeFileSync(join(wt, CORPUS_CACHE_REL), "not a gzip");
        expect(corpusUsable(join(wt, CORPUS_CACHE_REL), pinnedSha(wt))).toBe(
            false
        );
        const seed = seedPinnedCorpus(wt, primary, pinnedSha(wt), deps(NEW));
        expect(seed).toEqual({ ok: true, how: "fetched" });
    });

    it("the primary IS this tree: a mismatched cache is fetched over, not copied onto itself", () => {
        writePin(wt, NEW);
        writeCache(wt, OLD);
        const seed = seedPinnedCorpus(wt, wt, pinnedSha(wt), deps(NEW));
        expect(seed).toEqual({ ok: true, how: "fetched" });
        expect(cacheText(wt)).toBe("New");
    });

    it("a pin naming no sha256 is an error, not a pin-less tree", () => {
        mkdirSync(join(wt, "data"), { recursive: true });
        writeFileSync(join(wt, CORPUS_PIN_REL), JSON.stringify({}));
        expect(() => pinnedSha(wt)).toThrow(/names no `sha256`/);
        writeFileSync(join(wt, CORPUS_PIN_REL), "{");
        expect(() => pinnedSha(wt)).toThrow(/not valid JSON/);
    });

    it("a pin-less tree takes any cache, as before", () => {
        writeCache(primary, OLD);
        const seed = seedPinnedCorpus(wt, primary, pinnedSha(wt), deps(null));
        expect(seed).toEqual({ ok: true, how: "copied" });
        expect(readFileSync(join(wt, CORPUS_CACHE_REL)).length).toBeGreaterThan(
            0
        );
    });
});
