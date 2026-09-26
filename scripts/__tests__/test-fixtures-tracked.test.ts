// No file under a `__tests__/fixtures/` directory is git-ignored (issue
// #4738). PR #4735 committed a golden test whose input, `afk-excerpt.log`,
// matched `.gitignore`'s `*.log`: the lane gate passed in the author's
// worktree, where the file sat on disk, and every other tree ENOENTed — the
// base tip went health RED. This guard reds in exactly the tree that has the
// ignored file, the author's, at `land`'s lane — before it reaches the base.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const FIXTURE_DIR = /(^|\/)__tests__\/fixtures(\/|$)/;

function ignoredPaths(): string[] {
    const out = spawnSync(
        "git",
        [
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
        ],
        { encoding: "utf8", timeout: 30_000 }
    );
    if (out.status !== 0) throw new Error(`git ls-files failed: ${out.stderr}`);
    return out.stdout.split("\n").filter((line) => line !== "");
}

describe("test fixtures are never git-ignored (issue #4738)", () => {
    it("no ignored path lies under a __tests__/fixtures directory", () => {
        expect(ignoredPaths().filter((p) => FIXTURE_DIR.test(p))).toEqual([]);
    });

    it("the matcher sees a fixture path, and only a fixture path", () => {
        expect(FIXTURE_DIR.test("scripts/__tests__/fixtures/a/b.log")).toBe(
            true
        );
        expect(FIXTURE_DIR.test("convex/gre/__tests__/fixtures/")).toBe(true);
        expect(FIXTURE_DIR.test("scripts/__tests__/x.log")).toBe(false);
    });
});
