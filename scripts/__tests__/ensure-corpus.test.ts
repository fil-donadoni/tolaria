import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CORPUS_REFRESH_STEP } from "../housekeeping";

/**
 * Wiring of `corpus:ensure` (issue #6381): every site that hands a tree its
 * gitignored Card Corpus cache goes through the pin-checked seed, never a
 * bare copy of the primary's file. The decision itself is pinned by
 * `corpus-cache.test.ts`; these pin that nobody bypasses it.
 */
const read = (path: string): string => readFileSync(path, "utf8");

describe("corpus:ensure wiring", () => {
    it("is the package script for scripts/ensure-corpus.ts", () => {
        const pkg = JSON.parse(read("package.json")) as {
            scripts: Record<string, string>;
        };
        expect(pkg.scripts["corpus:ensure"]).toBe(
            "bun scripts/ensure-corpus.ts"
        );
    });

    it("ensure-corpus.ts seeds through the pin-checked decision", () => {
        const source = read("scripts/ensure-corpus.ts");
        expect(source).toContain("seedPinnedCorpus(");
        expect(source).toContain("pinnedSha(ROOT)");
    });

    it("worktree:init runs it, so a fresh tree never inherits a stale cache", () => {
        expect(read("scripts/bootstrap-worktree.ts")).toContain(
            '"scripts/ensure-corpus.ts"'
        );
    });

    it("housekeeping refreshes the primary's cache before listing merged PRs", () => {
        expect(CORPUS_REFRESH_STEP.argv).toEqual([
            "bun",
            "scripts/ensure-corpus.ts",
        ]);
        const source = read("scripts/housekeeping.ts");
        const refresh = source.indexOf("CORPUS_REFRESH_STEP]");
        expect(refresh).toBeGreaterThan(-1);
        expect(refresh).toBeLessThan(
            source.indexOf("merged = listMergedSince")
        );
    });

    it.each(["grammar-rule", "new-set"])(
        "the %s skill's step 0 never copies the primary's cache unchecked",
        (skill) => {
            const text = read(`.claude/skills/${skill}/SKILL.md`);
            expect(text).toContain("bun run corpus:ensure");
            expect(text).not.toMatch(/cp .*oracle-corpus\.json\.gz/);
        }
    );
});
