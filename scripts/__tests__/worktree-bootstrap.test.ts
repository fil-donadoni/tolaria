import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
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

describe("pre-push hook", () => {
    const HOOK = path.join(REPO_ROOT, ".husky", "pre-push");

    it("is tracked by git", () => {
        // `.husky/pre-commit` was deleted on 2026-06-17 inside a MERGE commit
        // (3ca58ca6 / 5cdbf196) and nobody noticed for six weeks, because a
        // missing hook is silent by design. Same exposure here.
        const r = spawnSync("git", ["ls-files", "--error-unmatch", HOOK], {
            cwd: REPO_ROOT,
            encoding: "utf8",
        });
        expect(r.status).toBe(0);
    });

    it("checks only the pushed diff, never the whole repo", () => {
        // A full `format:check` costs ~43s. In front of every push that is a
        // gate people disable, so the hook must stay diff-scoped.
        const code = fs
            .readFileSync(HOOK, "utf8")
            .split("\n")
            .filter((l) => !/^\s*#/.test(l))
            .join("\n");
        expect(code).toMatch(/prettier --check/);
        expect(code).toMatch(/git diff --name-only/);
        expect(code).not.toMatch(/format:check/);
    });

    // Functional exercise in a throwaway repo. The hook is POSIX sh run as
    // `sh -e` by husky's shim, where an `&&` guard returning non-zero is an
    // easy way to abort the whole script by accident — the kind of bug that is
    // invisible until a push silently stops being checked.
    describe("run against a scratch repo", () => {
        let tmp: string;
        let base: string;
        let drifted: string;
        let clean: string;

        const git = (...args: string[]) => {
            const r = spawnSync("git", args, { cwd: tmp, encoding: "utf8" });
            expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
            return r.stdout.trim();
        };

        /** Feed the hook one ref line, exactly as git does on push. */
        const runHook = (remoteSha: string, localSha: string) =>
            spawnSync("sh", ["-e", HOOK], {
                cwd: tmp,
                encoding: "utf8",
                input: `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`,
                env: {
                    ...process.env,
                    PATH: `${path.join(REPO_ROOT, "node_modules", ".bin")}:${process.env.PATH}`,
                },
            });

        beforeAll(() => {
            tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-prepush-"));
            git("init", "-q", "-b", "main");
            git("config", "user.email", "test@example.com");
            git("config", "user.name", "test");
            // No prettier config above a tmpdir, so prettier applies its
            // defaults — under which these two files are unambiguously
            // formatted / unformatted regardless of this repo's .prettierrc.
            fs.writeFileSync(path.join(tmp, "a.ts"), "const a = 1;\n");
            git("add", "-A");
            git("commit", "-qm", "base");
            base = git("rev-parse", "HEAD");

            fs.writeFileSync(path.join(tmp, "b.ts"), "const   b   =    2;\n");
            git("add", "-A");
            git("commit", "-qm", "drift");
            drifted = git("rev-parse", "HEAD");

            fs.writeFileSync(path.join(tmp, "c.ts"), "const c = 3;\n");
            git("add", "-A");
            git("commit", "-qm", "clean");
            clean = git("rev-parse", "HEAD");
        });

        afterAll(() => {
            fs.rmSync(tmp, { recursive: true, force: true });
        });

        it("rejects a push whose commits carry formatting drift", () => {
            const r = runHook(base, drifted);
            expect(r.status).toBe(1);
            expect(`${r.stdout}${r.stderr}`).toMatch(/bun run format/);
        });

        it("passes a push whose commits are clean", () => {
            // drifted..clean touches only c.ts — b.ts is already on the remote,
            // so this push is not the one that introduced it.
            const r = runHook(drifted, clean);
            expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        });

        it("passes a push that changes no checkable file", () => {
            const r = runHook(clean, clean);
            expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        });
    });
});

describe("light pre-PR gate", () => {
    it("`check:pr` runs every `check:all` check, plus the bot guards, without the mutex", () => {
        // check:index / check:ids / check:stubs cost <0.2s each. Leaving them
        // out of the pre-PR gate saved nothing and cost a merge-train re-gate
        // on every card-shipping PR (the card-index lockfile drift guard).
        //
        // `check:guards` (issue #1912) is the pre-PR gate's ONE addition over
        // `check:all`: the catalogue-wide guards (aiEffectsGuard, pickRatings,
        // opValuerCoverage, the moves/cardProfile censuses) all live in the BOT
        // suite, which the light gate never ran — three consecutive card PRs
        // reached a green `check:pr` while red in the bot suite. `check:all`
        // does NOT need it: it is followed by the full `bun run test`, which
        // runs the bot suite in full.
        const scripts = readPkg().scripts;
        expect(scripts["check:pr"]).toBe(
            "bun scripts/gate.ts light 'bun run check:all:inner && bun run check:guards'"
        );
        expect(scripts["check:all"]).toBe(
            "bun scripts/gate.ts heavy 'bun run check:all:inner'"
        );
        // The lane must stay the FAST one — a plain `vitest run` over the bot
        // projects would drag `ai-diagnosis.bot.test.ts` (163s of the suite's
        // 188s) into every pre-PR gate.
        expect(scripts["check:guards"]).toContain("TOLARIA_BOT_FAST=1");
        // …and it must also cover this directory. `scripts/__tests__` holds the
        // repo's own hygiene guards — including THIS test, which asserts the
        // shape of `check:pr` itself. Those live in the APPLICATION suite, so
        // before #1912 a change to the gate's own wiring could not be caught by
        // running the gate: this very assertion went red in CI while `check:pr`
        // reported green locally. 12 files, ~4s.
        expect(scripts["check:guards"]).toContain("scripts/__tests__");
    });
});
