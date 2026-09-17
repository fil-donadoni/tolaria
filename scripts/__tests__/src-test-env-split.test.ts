import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import picomatch from "picomatch";
import vitestConfig from "../../vitest.config";
import { splitScriptsTests, splitSrcTests } from "../test-env-split";

/**
 * The `src` test partition must stay a PARTITION.
 *
 * `vitest.config.ts` moves every DOM-free, mock-free `src/**\/*.test.ts` into
 * the node project (`splitSrcTests`) and excludes exactly those paths from the
 * dom project. The failure mode worth guarding is the quiet one: a file
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

function collectTests(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectTests(full, out);
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

/** Which projects would select `file`, by their own globs. */
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

const SRC_TESTS = collectTests(path.join(ROOT, "src")).sort();
const NON_BOT = SRC_TESTS.filter((f) => !f.endsWith(".bot.test.ts"));

describe("src test env split — every src test runs in exactly one project", () => {
    it("reads the real config (sanity — an unparsed config would vacuously pass)", () => {
        // `perf` (issue #3123) selects `*.perf.test.ts` only and `ladder`
        // (ADR 0136 §5) one declared glob; both are excluded from every
        // general project, so neither competes for another test.
        expect(projects?.map((p) => p.test?.name).sort()).toEqual([
            "bot-dom",
            "bot-node",
            "dom",
            "ladder",
            "node-engine",
            "node-tooling",
            "perf",
        ]);
        expect(SRC_TESTS.length).toBeGreaterThan(300);
    });

    it("moves a non-trivial share to node (an empty split is a silent no-op)", () => {
        const inNode = NON_BOT.filter((f) =>
            selectedBy(f).includes("node-engine")
        );
        expect(
            inNode.length,
            "No src test is selected by the node-engine project. Nothing breaks — everything still " +
                "runs — but the split is undone, and the dom project is back to paying " +
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
                "environments, and the dom copy hides a node-side breakage."
        ).toEqual([]);
    });

    it("routes bot src tests to the bot project only", () => {
        const bots = SRC_TESTS.filter((f) => f.endsWith(".bot.test.ts"));
        expect(bots.length).toBeGreaterThan(0);
        for (const f of bots) {
            expect(selectedBy(f), f).toEqual(
                f.endsWith("/ladder.bot.test.ts") ? ["ladder"] : ["bot-dom"]
            );
        }
    });
});

/**
 * The node project is two FIXED partitions, `node-engine` and `node-tooling`
 * (ADR 0136 §5, amending ADR 0104 §2). Same quiet failure as above, one axis
 * over: a scripts test in NEITHER partition runs nowhere and every gate stays
 * green; one in BOTH runs twice. And the partition is only worth its name if
 * the engine-facing guards stay in the partition the `engine` lane runs.
 */
describe("node partitions — every test file runs in exactly one project", () => {
    const ALL_TESTS = ["convex", "scripts", "src", "dashboard"]
        .flatMap((d) =>
            fs.existsSync(path.join(ROOT, d))
                ? collectTests(path.join(ROOT, d))
                : []
        )
        .sort();
    const split = splitScriptsTests(ROOT);

    it("selects every test file in the repo exactly once", () => {
        expect(ALL_TESTS.length).toBeGreaterThan(1000);
        const bad = ALL_TESTS.map((f) => [f, selectedBy(f)] as const).filter(
            ([, hits]) => hits.length !== 1
        );
        expect(
            bad.map(([f, hits]) => `${f} → ${hits.join("+") || "NOTHING"}`),
            "Each test file must be selected by exactly one vitest project. A file in neither " +
                "node partition never runs and never fails; a file in both runs twice."
        ).toEqual([]);
    });

    it("partitions scripts tests by the real predicate, both halves non-trivial", () => {
        const scripts = ALL_TESTS.filter(
            (f) =>
                f.startsWith("scripts/") && !/\.(bot|perf)\.test\.ts$/.test(f)
        );
        const engine = scripts.filter((f) =>
            selectedBy(f).includes("node-engine")
        );
        const tooling = scripts.filter((f) =>
            selectedBy(f).includes("node-tooling")
        );
        expect(engine).toEqual(split.engine);
        expect(tooling).toEqual(split.tooling);
        expect(engine.length).toBeGreaterThan(20);
        expect(tooling.length).toBeGreaterThan(20);
    });

    it("keeps every convex test in node-engine", () => {
        const convex = ALL_TESTS.filter(
            (f) => f.startsWith("convex/") && !/\.(bot|perf)\.test\.ts$/.test(f)
        );
        expect(convex.length).toBeGreaterThan(300);
        for (const f of convex)
            expect(selectedBy(f), f).toEqual(["node-engine"]);
    });

    it("routes the engine guards a convex/** diff can red to node-engine", () => {
        // A transitive importer of convex/ and two censuses that read the
        // engine tree through fs without importing it.
        for (const f of [
            "scripts/__tests__/catalogue-artifact.test.ts",
            "scripts/__tests__/bot-suite-boundary.test.ts",
            "scripts/__tests__/trigger-gate-marking.test.ts",
        ]) {
            expect(selectedBy(f), f).toEqual(["node-engine"]);
        }
        // …and the gate/land tooling stays out of it.
        for (const f of [
            "scripts/__tests__/gate-run.test.ts",
            "scripts/__tests__/pr-merge.test.ts",
        ]) {
            expect(selectedBy(f), f).toEqual(["node-tooling"]);
        }
    });
});
