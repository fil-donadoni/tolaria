import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import picomatch from "picomatch";
import vitestConfig from "../../vitest.config";
import { splitSrcTests } from "../test-env-split";

/**
 * The `src` test partition must stay a PARTITION.
 *
 * `vitest.config.ts` moves every DOM-free, mock-free `src/**\/*.test.ts` into
 * the node project (`splitSrcTests`) and excludes exactly those paths from the
 * jsdom project. The failure mode worth guarding is the quiet one: a file
 * claimed by NEITHER project runs nowhere, and `bun run test` reports green
 * over a test the runner never selected. Nothing else in the gate distinguishes
 * "passed" from "was never picked up" — the suite total is not something anyone
 * reads per-file.
 *
 * So this resolves the REAL config's include/exclude globs against the REAL
 * file list, the same way vitest does, rather than re-deriving the split and
 * comparing it to itself. A hand-edited literal, a stale exclude, a typo'd glob
 * — all show up here as an uncovered file.
 *
 * The opposite error — a file misclassified as node-safe when it needs a DOM —
 * needs no guard: it goes red in the node project on the same run.
 */

const ROOT = path.resolve(__dirname, "../..");

function collectSrcTests(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectSrcTests(full, out);
        else if (/\.test\.tsx?$/.test(entry.name)) {
            out.push(path.relative(ROOT, full).split(path.sep).join("/"));
        }
    }
    return out;
}

interface ProjectConfig {
    test?: {
        name?: string;
        include?: string[];
        exclude?: string[];
    };
}

const projects = (vitestConfig as { test?: { projects?: ProjectConfig[] } })
    .test?.projects;

/** Which of the four projects would select `file`, by its own globs. */
function selectedBy(file: string): string[] {
    return (projects ?? [])
        .filter((p) => {
            const include = p.test?.include ?? [];
            const exclude = p.test?.exclude ?? [];
            const included = include.some((g) => picomatch(g)(file));
            const excluded = exclude.some((g) => picomatch(g)(file));
            return included && !excluded;
        })
        .map((p) => p.test?.name ?? "?");
}

const SRC_TESTS = collectSrcTests(path.join(ROOT, "src")).sort();
const NON_BOT = SRC_TESTS.filter((f) => !f.endsWith(".bot.test.ts"));

describe("src test env split — every src test runs in exactly one project", () => {
    it("reads the real config (sanity — an unparsed config would vacuously pass)", () => {
        expect(projects?.map((p) => p.test?.name).sort()).toEqual([
            "bot-jsdom",
            "bot-node",
            "jsdom",
            "node",
        ]);
        expect(SRC_TESTS.length).toBeGreaterThan(300);
    });

    it("moves a non-trivial share to node (an empty split is a silent no-op)", () => {
        const inNode = NON_BOT.filter((f) => selectedBy(f).includes("node"));
        expect(
            inNode.length,
            "No src test is selected by the node project. Nothing breaks — everything still " +
                "runs — but the split is undone, and the jsdom project is back to paying " +
                "per-file environment init (~0.4s each) for pure-logic tests."
        ).toBeGreaterThan(50);
        expect(inNode).toEqual(splitSrcTests(ROOT).node);
    });

    it("selects every src test exactly once", () => {
        const bad = NON_BOT.map((f) => [f, selectedBy(f)] as const).filter(
            ([, hits]) => hits.length !== 1
        );
        expect(
            bad.map(([f, hits]) => `${f} → ${hits.join("+") || "NOTHING"}`),
            "Each src test must be selected by exactly one project. A file selected by none " +
                "never runs and never fails; a file selected by two runs twice, in two " +
                "environments, and the jsdom copy hides a node-side breakage."
        ).toEqual([]);
    });

    it("routes bot src tests to the bot project only", () => {
        const bots = SRC_TESTS.filter((f) => f.endsWith(".bot.test.ts"));
        expect(bots.length).toBeGreaterThan(0);
        for (const f of bots) expect(selectedBy(f)).toEqual(["bot-jsdom"]);
    });
});
