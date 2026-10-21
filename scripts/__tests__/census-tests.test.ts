import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
    CENSUS_TESTS,
    CENSUS_WALK_EXEMPT,
    DIRECTORY_WALK,
} from "../lib/census-tests";
import { botTests, generalTests } from "../lib/test-reach";

/**
 * Issue #5535 — the census-test table is the lane's only way to plan a test
 * that discovers its corpus through the filesystem (`census-tests.ts`). A
 * directory-walking test missing from it is planned only when the diff
 * touches something it imports, which is how PR #5534 landed a red base.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TESTS_DIR = path.join(REPO_ROOT, "scripts", "__tests__");

function walkingTests(): string[] {
    return fs
        .readdirSync(TESTS_DIR)
        .filter((f) => /\.test\.tsx?$/.test(f))
        .map((f) => path.posix.join("scripts", "__tests__", f))
        .filter((rel) =>
            DIRECTORY_WALK.test(
                fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")
            )
        )
        .sort();
}

const declared = new Set(CENSUS_TESTS.map(({ test }) => test));

describe("census-tests — every directory-walking test is declared or exempt (issue #5535)", () => {
    it("classifies every scripts/__tests__ file that walks a directory or greps the tree", () => {
        const unclassified = walkingTests().filter(
            (rel) => !declared.has(rel) && !(rel in CENSUS_WALK_EXEMPT)
        );
        expect(
            unclassified,
            "These tests walk a directory or grep the tree but are in neither CENSUS_TESTS nor CENSUS_WALK_EXEMPT " +
                "(scripts/lib/census-tests.ts). A census of repo files → a CENSUS_TESTS row whose `admits` matches the paths it " +
                "reads, so check:lane plans it when its corpus changes; a scratch/runtime walk → CENSUS_WALK_EXEMPT with the reason."
        ).toEqual([]);
    });

    it("no test is both declared and exempt, and no row is stale", () => {
        const walking = new Set(walkingTests());
        expect(
            [...declared].filter((t) => t in CENSUS_WALK_EXEMPT),
            "declared AND exempt"
        ).toEqual([]);
        expect(
            Object.keys(CENSUS_WALK_EXEMPT).filter((t) => !walking.has(t)),
            "exempt rows whose file no longer walks (or no longer exists) — drop them"
        ).toEqual([]);
    });

    it("every declared census is a general or a bot fast lane test, so a lane can plan it", () => {
        const general = generalTests(REPO_ROOT);
        const bot = botTests(REPO_ROOT);
        expect(
            CENSUS_TESTS.map(({ test }) => test).filter(
                (t) => !general.has(t) && !bot.has(t)
            ),
            "a CENSUS_TESTS row the lane can never run (missing file, or a perf/ladder test)"
        ).toEqual([]);
    });
});
