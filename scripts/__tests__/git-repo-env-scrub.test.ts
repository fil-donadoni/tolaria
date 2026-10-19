/**
 * Inherited git repository env must never reach a test's git (issue #6017).
 *
 * A hook in a linked worktree exports `GIT_DIR=<primary>/.git/worktrees/<n>`;
 * a test's throwaway `git init` under it re-initialised the SHARED repository
 * as bare. The canary below is that shape in a scratch repo: a primary plus a
 * linked worktree, whose worktree git dir is what a hook would export.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GIT_REPO_ENV_KEYS, scrubGitRepoEnv } from "../lib/git-repo-env";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

describe("git repository env scrub (issue #6017)", () => {
    let tmp: string;
    let canary: string;
    let canaryWorktreeGitDir: string;

    const git = (cwd: string, args: string[], env = process.env) =>
        spawnSync("git", args, { cwd, encoding: "utf8", env });
    const isBare = () =>
        git(canary, ["config", "core.bare"]).stdout.trim() === "true";
    /** What a test helper does: a throwaway `git init` in a fresh dir. */
    const throwawayInit = (env: NodeJS.ProcessEnv) => {
        const dir = fs.mkdtempSync(path.join(tmp, "throwaway-"));
        return git(dir, ["init", "-q"], env);
    };
    const hookEnv = (): NodeJS.ProcessEnv => ({
        ...process.env,
        GIT_DIR: canaryWorktreeGitDir,
        GIT_INDEX_FILE: path.join(canaryWorktreeGitDir, "index"),
    });

    beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-git-env-"));
        canary = path.join(tmp, "canary");
        fs.mkdirSync(canary);
        for (const args of [
            ["init", "-q"],
            [
                "-c",
                "user.email=t@t",
                "-c",
                "user.name=t",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                "x",
            ],
            ["worktree", "add", "-q", path.join(tmp, "wt")],
        ]) {
            const r = git(canary, args);
            expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
        }
        canaryWorktreeGitDir = path.join(canary, ".git", "worktrees", "wt");
        expect(isBare()).toBe(false);
    });

    afterAll(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("the canary is live: an unscrubbed hook env turns it bare", () => {
        // Without this the assertions below could pass on a canary git never
        // reaches, and prove nothing.
        throwawayInit(hookEnv());
        expect(isBare()).toBe(true);
        expect(git(canary, ["config", "core.bare", "false"]).status).toBe(0);
    });

    it("a scrubbed hook env leaves the canary untouched", () => {
        const env = hookEnv();
        scrubGitRepoEnv(env);
        for (const key of GIT_REPO_ENV_KEYS) expect(env[key]).toBeUndefined();
        expect(throwawayInit(env).status).toBe(0);
        expect(isBare()).toBe(false);
    });

    it("every vitest setup file scrubs the environment before any test runs", () => {
        // The scrub is only as good as its wiring: a project whose setup file
        // drops the call hands the hook's GIT_DIR to every test it runs.
        const config = fs.readFileSync(
            path.join(REPO_ROOT, "vitest.config.ts"),
            "utf8"
        );
        const setupFiles = new Set(
            [...config.matchAll(/setupFiles:\s*\[([^\]]*)\]/g)].flatMap((m) =>
                [...m[1].matchAll(/"([^"]+)"/g)].map((f) => f[1])
            )
        );
        expect(setupFiles.size).toBeGreaterThan(0);
        for (const file of setupFiles) {
            const code = fs
                .readFileSync(path.join(REPO_ROOT, file), "utf8")
                .split("\n")
                .filter((l) => !/^\s*\/\//.test(l))
                .join("\n");
            expect(code, file).toMatch(/^scrubGitRepoEnv\(\);$/m);
        }
    });

    it("the pre-push hook unsets the same keys before its gate", () => {
        const hook = fs.readFileSync(
            path.join(REPO_ROOT, ".husky", "pre-push"),
            "utf8"
        );
        const unset = hook.match(/^\s*unset (GIT_[A-Z_ ]+)$/m);
        expect(unset).not.toBeNull();
        expect(unset![1].trim().split(/\s+/).sort()).toEqual(
            [...GIT_REPO_ENV_KEYS].sort()
        );
        expect(hook.indexOf(unset![0])).toBeLessThan(
            hook.indexOf("bun run check:all")
        );
    });
});
