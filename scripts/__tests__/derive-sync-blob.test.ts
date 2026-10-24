/**
 * `derive:sync`'s whole-blob read (issue #6642): the Bot-play replay's
 * moved-tip path parses the ~20 MB lockfile as committed at the new tip. The
 * child process's 1 MB default buffer cut it at ~1.26 MB (ENOBUFS), and the
 * partial text reached `parseLockfile` as "Unterminated string" after a
 * 39-minute sweep, on every replay the base moved under.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blobAt } from "../derive-sync";

describe("blobAt — a committed file's whole text at a revision (issue #6642)", () => {
    let repo: string;
    const git = (...args: string[]): string => {
        const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
        if (r.status !== 0)
            throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
        return r.stdout.trim();
    };

    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), "derive-sync-blob-"));
        git("init", "-q", "-b", "main");
        git("config", "user.email", "t@example.com");
        git("config", "user.name", "t");
        git("config", "commit.gpgsign", "false");
    });
    afterEach(() =>
        rmSync(repo, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        })
    );

    it("reads a blob past the 1 MB child-process default whole — the lockfile is ~20 MB", () => {
        // 3 MB of JSON: past the default that truncated the real read.
        const big = JSON.stringify({ rows: "x".repeat(3 * 1024 * 1024) });
        writeFileSync(join(repo, "lock.json"), big);
        git("add", ".");
        git("commit", "-q", "-m", "seed");
        const r = blobAt("HEAD", "lock.json", repo);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.text.length).toBe(big.length);
    });

    it("a missing path is a failure naming the read, never an empty text", () => {
        writeFileSync(join(repo, "a.txt"), "a");
        git("add", ".");
        git("commit", "-q", "-m", "seed");
        const r = blobAt("HEAD", "lock.json", repo);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.why).toMatch(/^git show HEAD:lock\.json failed: /);
    });
});
