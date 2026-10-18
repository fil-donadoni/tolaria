import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    cardDataKind,
    cardDataSizes,
    catalogueGzipBytes,
    handWrittenSetCodes,
    judgeGameDownload,
    manifestBudget,
} from "../lib/game-download";

/**
 * A game's card-data download is bounded by its own Manifest (issue #5618,
 * PRD #5602). `bun run check:game-download` measures it in a browser on a
 * production build; this file pins its verdict over a fake `dist/`, so
 * "fetch the whole catalogue, watch red" is a permanent test.
 */

const roots: string[] = [];

function fakeDist(chunks: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "game-download-"));
    roots.push(dir);
    mkdirSync(join(dir, "assets"));
    for (const [name, source] of Object.entries(chunks)) {
        writeFileSync(join(dir, "assets", name), source);
    }
    return dir;
}

afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true });
});

// The shape `vite build` emits: a Set may import another Set's helper
// (`drk` → `lea`); compiled shards, the index and the dictionary are hashed
// JSON; the Full Catalogue is a gzip; the rest is code.
const DIST = {
    "index-AAAA1111.js": `import("./game.route-DDDD4444.js");`,
    "game.route-DDDD4444.js": `export const g=1;`,
    "card-set-lea-GGGG7777.js": `export const c=${"1".repeat(400)};`,
    "card-set-drk-KKKK1111.js": `import{c}from"./card-set-lea-GGGG7777.js";export const d=c;`,
    "card-set-ice-LLLL2222.js": `export const i=${"2".repeat(4000)};`,
    "compiled-shard-mir-dd14ab094a1d.json": `{"rows":"${"m".repeat(300)}"}`,
    "compiled-shard-tmp-0123456789ab.json": `{"rows":"${"t".repeat(3000)}"}`,
    "compiled-index-a0cf780c519c.json": `{"names":"${"n".repeat(2000)}"}`,
    "compiled-dictionary-306b518812ae.json": `{"d":1}`,
    "full-catalogue-b679977ae10d73b8.json-DrOI2pdZ.gz": "x".repeat(5000),
};

const INDEX = JSON.stringify({
    entries: [
        ["id-lightning", "Lightning Bolt", "lea", "lightningBolt"],
        ["id-drk", "Dark Card", "drk", "darkCard"],
        ["id-ice", "Ice Card", "ice", "iceCard"],
    ],
});

describe("cardDataKind — what is card data", () => {
    it("names Sets, shards, the index, the dictionary and the whole catalogue; code is null", () => {
        expect(cardDataKind("card-set-lea-GGGG7777.js")).toBe("set");
        expect(cardDataKind("card-set-m10-ab-cd_efg.js")).toBe("set");
        expect(cardDataKind("compiled-shard-mir-dd14ab094a1d.json")).toBe(
            "shard"
        );
        expect(cardDataKind("compiled-index-a0cf780c519c.json")).toBe("index");
        expect(cardDataKind("compiled-dictionary-306b518812ae.json")).toBe(
            "dictionary"
        );
        expect(
            cardDataKind("full-catalogue-b679977ae10d73b8.json-DrOI2pdZ.gz")
        ).toBe("catalogue");
        expect(cardDataKind("packed-corpus-YygP3Rut.json")).toBe("catalogue");
        expect(cardDataKind("game.route-DDDD4444.js")).toBeNull();
        expect(cardDataKind("catalogue-gate-Blb60Ovg.js")).toBeNull();
    });
});

describe("manifestBudget — what a game's Manifest names", () => {
    const handWritten = handWrittenSetCodes(INDEX);

    it("a hand-written card names its Set and the Sets that Set imports; a compiled card its shard; the dictionary always", () => {
        const dist = fakeDist(DIST);
        const budget = manifestBudget(
            dist,
            [
                { definitionId: "id-drk", setCode: "drk" },
                { definitionId: "id-drk", setCode: "drk" },
                { definitionId: "compiled-mir-row", setCode: "mir" },
                // No shard here and no hand-written Set: nothing to fetch.
                { definitionId: "compiled-zzz-row", setCode: "zzz" },
            ],
            handWritten
        );
        expect(budget.assets).toEqual([
            "card-set-drk-KKKK1111.js",
            "card-set-lea-GGGG7777.js",
            "compiled-dictionary-306b518812ae.json",
            "compiled-shard-mir-dd14ab094a1d.json",
        ]);
        const sizes = cardDataSizes(dist);
        expect(budget.gzipBytes).toBe(
            budget.assets.reduce((n, a) => n + sizes.get(a)!, 0)
        );
    });

    it("the client's index wins over the entry's setCode hint for a hand-written card", () => {
        const budget = manifestBudget(
            fakeDist(DIST),
            [{ definitionId: "id-ice", setCode: "tmp" }],
            handWritten
        );
        expect(budget.assets).toContain("card-set-ice-LLLL2222.js");
        expect(budget.assets).not.toContain(
            "compiled-shard-tmp-0123456789ab.json"
        );
    });
});

describe("judgeGameDownload — fetched against the Manifest", () => {
    const handWritten = handWrittenSetCodes(INDEX);
    const MANIFEST = [
        { definitionId: "id-lightning", setCode: "lea" },
        { definitionId: "compiled-mir-row", setCode: "mir" },
    ];

    it("passes a game that fetched what its Manifest names, code beside it", () => {
        const dist = fakeDist(DIST);
        const sizes = cardDataSizes(dist);
        const budget = manifestBudget(dist, MANIFEST, handWritten, sizes);
        const report = judgeGameDownload(
            {
                game: "solo",
                fetched: [...budget.assets, "game.route-DDDD4444.js"],
                budget,
            },
            sizes
        );
        expect(report.failures).toEqual([]);
        expect(report.fetchedGzipBytes).toBe(budget.gzipBytes);
    });

    // Proof of failure — the game gate back in whole-catalogue mode: every
    // Set and every shard installed (`installAllShards`).
    it("reds a game that installed the whole catalogue", () => {
        const dist = fakeDist(DIST);
        const sizes = cardDataSizes(dist);
        const budget = manifestBudget(dist, MANIFEST, handWritten, sizes);
        const whole = [...sizes.keys()].filter(
            (a) => cardDataKind(a) !== "catalogue"
        );
        const report = judgeGameDownload(
            { game: "solo", fetched: whole, budget },
            sizes
        );
        expect(report.fetchedGzipBytes).toBe(catalogueGzipBytes(sizes));
        expect(report.unnamed).toEqual([
            "card-set-drk-KKKK1111.js",
            "card-set-ice-LLLL2222.js",
            "compiled-index-a0cf780c519c.json",
            "compiled-shard-tmp-0123456789ab.json",
        ]);
        expect(report.failures).toEqual([
            expect.stringContaining("no Manifest entry names"),
        ]);
    });

    it("reds a game that fetched the Full Catalogue", () => {
        const dist = fakeDist(DIST);
        const sizes = cardDataSizes(dist);
        const budget = manifestBudget(dist, MANIFEST, handWritten, sizes);
        const report = judgeGameDownload(
            {
                game: "bot",
                fetched: [
                    ...budget.assets,
                    "full-catalogue-b679977ae10d73b8.json-DrOI2pdZ.gz",
                ],
                budget,
            },
            sizes
        );
        expect(report.unnamed).toEqual([
            "full-catalogue-b679977ae10d73b8.json-DrOI2pdZ.gz",
        ]);
        expect(report.failures).toHaveLength(1);
    });

    it("reds a game that fetched no card data — the check cannot go vacuous", () => {
        const dist = fakeDist(DIST);
        const sizes = cardDataSizes(dist);
        const budget = manifestBudget(dist, MANIFEST, handWritten, sizes);
        const report = judgeGameDownload(
            { game: "solo", fetched: ["game.route-DDDD4444.js"], budget },
            sizes
        );
        expect(report.failures).toEqual([
            expect.stringContaining("no card data fetched at all"),
        ]);
    });
});
