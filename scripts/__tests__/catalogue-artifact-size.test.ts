import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { PACKED_CORPUS_PATH } from "../lib/packed-corpus";
import { SEARCH_INDEX_PATH } from "../lib/search-index";

/**
 * Size budget for the SERVED catalogue assets (issue #3053, ADR 0113 §3;
 * subjects changed by issue #4861, ADR 0113 Amendment IV).
 *
 * Its ancestor (`oracle-pool-size.test.ts`, issue #2702) budgeted the
 * compiled pool as a BUNDLE cost; issue #3053 moved the rows into a fetched
 * artifact, `catalogue-<hash>.json`, budgeted here as the whole corpus every
 * client held in its heap. Issue #4861 changed WHAT a client downloads:
 *
 *   - a page that renders a game (and the Bot worker) fetches the PACKED
 *     corpus, `data/catalogue/packed-corpus.json` — the server's own file —
 *     and decodes a block on first request: its heap is the packed bytes plus
 *     the cards of the game, not the corpus;
 *   - the deck builder also fetches the SEARCH INDEX,
 *     `data/catalogue/search-index.json`, one row per catalogue card.
 *
 * `catalogue-<hash>.json` is still generated — the anchor every rendering is
 * compared with — but no client fetches it any more, so it is no longer a
 * cost anyone pays and no longer budgeted here.
 *
 * THE TRADE, measured 2026-10-06 at 4,360 compiled rows: the packed corpus is
 * 929,316 B raw / 573,005 B Brotli against the retired artifact's 2,838,356 B
 * / 311,433 B — deflated blocks in base64 do not re-compress, so a cold game
 * load downloads ~260 KB more, in exchange for not parsing (nor holding) the
 * corpus. The search index is 1,624,112 B / 292,881 B, deck builder only.
 *
 * WHAT CROSSING MEANS: these are DISCLOSURE triggers at ~2.6x today, not
 * walls. Crossing one means the download has roughly tripled since it was
 * last measured: re-measure (`bun run measure:client-heap` for the heap,
 * the browser for the fetch), restate the numbers above, and set the ceiling
 * from that measurement — never raise it to get a green run.
 */
const REPO_ROOT = resolve(__dirname, "..", "..");

/**
 * How long one Brotli assertion may take.
 *
 * NOT a slow test tolerated — a measurement whose cost is the point.
 * `brotliCompressSync` at its default quality 11 is what a CDN serves these
 * with, so dropping the quality would make the number stop describing the
 * download. Measured 2026-09-07 on a 1.46 MB asset, machine idle: ~1.8 s;
 * `check:all` runs the heavy tier at `ncpu - 1` workers and this file then
 * loses its core for most of the compression (it timed out at vitest's 5 s
 * default in `health:main`, run 017afb33). So the ceiling is the measurement
 * plus contention headroom, not a default nobody chose.
 */
const BROTLI_TIMEOUT_MS = 60_000;

interface ServedAsset {
    readonly path: string;
    readonly who: string;
    readonly rawBudgetBytes: number;
    readonly brotliBudgetBytes: number;
}

const SERVED: readonly ServedAsset[] = [
    {
        path: PACKED_CORPUS_PATH,
        who: "every game, page and Bot worker",
        // ~2.7x today's 929,316 B.
        rawBudgetBytes: 2_500_000,
        // ~2.6x today's 573,005 B.
        brotliBudgetBytes: 1_500_000,
    },
    {
        path: SEARCH_INDEX_PATH,
        who: "the deck builder",
        // ~2.7x today's 1,624,112 B.
        rawBudgetBytes: 4_400_000,
        // ~2.7x today's 292,881 B.
        brotliBudgetBytes: 800_000,
    },
];

describe("Catalogue artifact generation wiring (issue #3053)", () => {
    const pkg = JSON.parse(
        readFileSync(resolve(REPO_ROOT, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    it("exposes catalogue:pack and catalogue:check, backed by a real file", () => {
        expect(pkg.scripts["catalogue:pack"]).toContain(
            "catalogue-artifact.ts"
        );
        expect(pkg.scripts["catalogue:check"]).toContain("--check");
        expect(
            existsSync(resolve(REPO_ROOT, "scripts/catalogue-artifact.ts"))
        ).toBe(true);
    });

    it.each(SERVED)(
        "ships $path itself (committed, not generated per deploy)",
        ({ path }) => {
            expect(existsSync(resolve(REPO_ROOT, path))).toBe(true);
        }
    );
});

describe("Served catalogue asset size budgets (issue #4861, ADR 0113 Amendment IV)", () => {
    it.each(SERVED)(
        "$path stays under its raw budget — past it, re-measure and restate, don't raise the number",
        ({ path, who, rawBudgetBytes }) => {
            const size = statSync(resolve(REPO_ROOT, path)).size;
            console.log(
                `${path} (${who}): ${(size / 1024).toFixed(1)} KB raw (budget: ${(
                    rawBudgetBytes / 1024
                ).toFixed(0)} KB)`
            );
            expect(size).toBeLessThanOrEqual(rawBudgetBytes);
        }
    );

    it.each(SERVED)(
        "$path stays under its Brotli budget — the bytes a cold load really fetches",
        ({ path, who, brotliBudgetBytes }) => {
            const compressed = brotliCompressSync(
                readFileSync(resolve(REPO_ROOT, path))
            );
            console.log(
                `${path} (${who}): ${(compressed.length / 1024).toFixed(1)} KB Brotli (budget: ${(
                    brotliBudgetBytes / 1024
                ).toFixed(0)} KB)`
            );
            expect(compressed.length).toBeLessThanOrEqual(brotliBudgetBytes);
        },
        BROTLI_TIMEOUT_MS
    );
});
