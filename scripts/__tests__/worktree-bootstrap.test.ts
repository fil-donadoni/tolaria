import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Guards for the "a fresh worktree is not runnable" failure class.
 *
 * Three inputs this repo needs at runtime are gitignored (`node_modules`,
 * `convex/_generated`, `.env.local`) plus husky's generated `.husky/_`. The
 * rule for restoring them lived in prose and was measurably ignored twice:
 * once producing a phantom red baseline (~216 files failing at *import*, 0
 * tests failing), once letting prettier drift reach the merge-train because
 * the pre-commit hook was never in git at all.
 *
 * These assertions are cheap and offline; they guard the wiring, not the copy
 * itself (which is exercised every time an agent bootstraps a worktree).
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readPkg(): { scripts: Record<string, string> } {
    return JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
    );
}

describe("worktree bootstrap wiring", () => {
    it("exposes `worktree:init`, pointed at the bootstrap script", () => {
        expect(readPkg().scripts["worktree:init"]).toBe(
            "bun scripts/bootstrap-worktree.ts"
        );
    });

    it("bootstrap script imports node builtins only", () => {
        // It runs in a worktree that has no node_modules yet — a single
        // third-party import would make it unable to do its own job.
        const src = fs.readFileSync(
            path.join(REPO_ROOT, "scripts", "bootstrap-worktree.ts"),
            "utf8"
        );
        const imports = [...src.matchAll(/^import .* from "(.+)";$/gm)].map(
            (m) => m[1]
        );
        expect(imports.length).toBeGreaterThan(0);
        for (const spec of imports) expect(spec).toMatch(/^node:/);
    });
});

describe("pre-commit hook", () => {
    it("is tracked by git", () => {
        // The original bug: `.husky/pre-commit` existed nowhere, so husky's
        // shim (`.husky/_/h` does `[ ! -f "$s" ] && exit 0`) silently no-oped
        // in EVERY checkout — lint-staged never ran anywhere.
        const r = spawnSync(
            "git",
            ["ls-files", "--error-unmatch", ".husky/pre-commit"],
            {
                cwd: REPO_ROOT,
                encoding: "utf8",
            }
        );
        expect(r.status).toBe(0);
    });

    it("runs lint-staged", () => {
        const hook = fs.readFileSync(
            path.join(REPO_ROOT, ".husky", "pre-commit"),
            "utf8"
        );
        expect(hook).toMatch(/^\s*lint-staged\s*$/m);
    });
});

describe("light pre-PR gate", () => {
    it("`check:pr` runs the same checks as `check:all`, without the mutex", () => {
        // check:index / check:ids / check:stubs cost <0.2s each. Leaving them
        // out of the pre-PR gate saved nothing and cost a merge-train re-gate
        // on every card-shipping PR (the card-index lockfile drift guard).
        const scripts = readPkg().scripts;
        expect(scripts["check:pr"]).toBe(
            "bun scripts/gate.ts light 'bun run check:all:inner'"
        );
        expect(scripts["check:all"]).toBe(
            "bun scripts/gate.ts heavy 'bun run check:all:inner'"
        );
    });
});
