/**
 * The vitest file order (issue #4483): longest project first, each project's
 * files contiguous, longest file first — read from a FAKE duration cache, so
 * the rule is pinned without running a suite.
 */
import { describe, expect, it } from "vitest";
import type { TestSpecification } from "vitest/node";
import vitestConfig from "../../vitest.config";
import {
    LongestFirstSequencer,
    orderSpecs,
    type SpecKey,
} from "../lib/vitest-sequencer";

const spec = (project: string, file: string, groupOrder = 0): SpecKey => ({
    project,
    file,
    groupOrder,
});

/** The fake cache: `<project>:<file>` → ms, the key vitest itself writes. */
const cacheOf =
    (entries: Record<string, number>) => (project: string, file: string) =>
        entries[`${project}:${file}`];

const label = (s: SpecKey) => `${s.project}:${s.file}`;

describe("orderSpecs — the ordering rule", () => {
    // The shape of the measured problem: `node-engine` sorts first by name,
    // but `node-tooling` holds the single longest file (loop-drain, 59 s) and
    // the larger project total.
    const specs = [
        spec("node-engine", "convex/a.test.ts"),
        spec("node-tooling", "scripts/small.test.ts"),
        spec("node-engine", "convex/b.test.ts"),
        spec("node-tooling", "scripts/loop-drain.test.ts"),
        spec("node-engine", "convex/c.test.ts"),
        spec("dom", "src/x.test.tsx"),
    ];
    const cache = cacheOf({
        "node-engine:convex/a.test.ts": 10_000,
        "node-engine:convex/b.test.ts": 30_000,
        "node-engine:convex/c.test.ts": 5_000,
        "node-tooling:scripts/small.test.ts": 1_000,
        "node-tooling:scripts/loop-drain.test.ts": 59_000,
        "dom:src/x.test.tsx": 2_000,
    });

    it("runs projects by cached total descending, longest file first inside each", () => {
        expect(orderSpecs(specs, (s) => s, cache).map(label)).toEqual([
            "node-tooling:scripts/loop-drain.test.ts", // 60 s total
            "node-tooling:scripts/small.test.ts",
            "node-engine:convex/b.test.ts", // 45 s total
            "node-engine:convex/a.test.ts",
            "node-engine:convex/c.test.ts",
            "dom:src/x.test.tsx", // 2 s total
        ]);
    });

    it("keeps every project's files contiguous — one run per project in the queue", () => {
        // A non-isolated worker is reused only while the next queued file is
        // the same project's; an interleaved queue restarts it per switch.
        const projects = orderSpecs(specs, (s) => s, cache).map(
            (s) => s.project
        );
        const runs = projects.filter((p, i) => p !== projects[i - 1]);
        expect(runs).toEqual([...new Set(projects)]);
    });

    it("reorders, never filters — the result is a permutation of the input", () => {
        const out = orderSpecs(specs, (s) => s, cache);
        expect(out).toHaveLength(specs.length);
        expect(new Set(out)).toEqual(new Set(specs));
    });

    it("puts files with no cached duration first inside their project", () => {
        const withNew = [...specs, spec("node-engine", "convex/new.test.ts")];
        const engine = orderSpecs(withNew, (s) => s, cache)
            .filter((s) => s.project === "node-engine")
            .map((s) => s.file);
        expect(engine[0]).toBe("convex/new.test.ts");
    });

    it("an empty cache degrades to project name, then path — never to input order", () => {
        const out = orderSpecs([...specs].reverse(), (s) => s, cacheOf({}));
        expect(out.map(label)).toEqual([
            "dom:src/x.test.tsx",
            "node-engine:convex/a.test.ts",
            "node-engine:convex/b.test.ts",
            "node-engine:convex/c.test.ts",
            "node-tooling:scripts/loop-drain.test.ts",
            "node-tooling:scripts/small.test.ts",
        ]);
    });

    it("never crosses a sequence.groupOrder boundary, however long the later group", () => {
        const grouped = [
            spec("late", "z.test.ts", 1),
            spec("early", "a.test.ts", 0),
        ];
        const out = orderSpecs(
            grouped,
            (s) => s,
            cacheOf({ "late:z.test.ts": 99_000, "early:a.test.ts": 1 })
        );
        expect(out.map((s) => s.project)).toEqual(["early", "late"]);
    });
});

describe("LongestFirstSequencer — the vitest seam", () => {
    it("reads vitest's own `<project>:<relative path>` cache key", async () => {
        // A fake `Vitest` context: only the fields the sequencer touches. Name
        // order would run `alpha` first; the cache must put `omega` first.
        const root = "/repo";
        const durations: Record<string, number> = {
            "alpha:convex/s.test.ts": 1,
            "omega:convex/l.test.ts": 50,
        };
        const ctx = {
            config: { root },
            cache: {
                getFileTestResults: (key: string) =>
                    key in durations ? { duration: durations[key] } : undefined,
            },
        };
        const fake = (project: string, file: string) =>
            ({
                project: {
                    name: project,
                    config: { sequence: { groupOrder: 0 } },
                },
                moduleId: `${root}/${file}`,
            }) as unknown as TestSpecification;

        const sequencer = new LongestFirstSequencer(ctx as never);
        const out = await sequencer.sort([
            fake("alpha", "convex/s.test.ts"),
            fake("omega", "convex/l.test.ts"),
        ]);
        expect(out.map((s) => s.project.name)).toEqual(["omega", "alpha"]);
    });

    it("is the sequencer `vitest.config.ts` registers", () => {
        expect(vitestConfig.test?.sequence?.sequencer).toBe(
            LongestFirstSequencer
        );
    });
});
