import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureGitConfig } from "../lib/git-config-keys";

/**
 * Issue #5958: jobs started together on one machine ran `worktree:init`
 * concurrently and one failed on `could not lock config file … File exists`,
 * because every run rewrote merge-driver keys that were already correct.
 *
 * A held `.git/config.lock` is the race made deterministic: any `git config`
 * write meets it, a read does not.
 */

let repo: string;
let lock: string;

function git(...args: string[]): string {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
}

beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "git-config-keys-"));
    git("init", "-q");
    lock = path.join(repo, ".git", "config.lock");
});

afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
});

describe("ensureGitConfig (issue #5958)", () => {
    it("writes a key that is unset", () => {
        expect(ensureGitConfig("merge.x.driver", "cmd %A", { cwd: repo })).toBe(
            "written"
        );
        expect(git("config", "--get", "merge.x.driver")).toBe("cmd %A");
    });

    it("performs no write when the key already holds the value", () => {
        git("config", "merge.x.driver", "cmd %A");
        // git writes config through `config.lock` + rename, even for an
        // unchanged value, so any write replaces the file's inode.
        const config = path.join(repo, ".git", "config");
        const before = fs.statSync(config).ino;
        expect(ensureGitConfig("merge.x.driver", "cmd %A", { cwd: repo })).toBe(
            "present"
        );
        expect(fs.statSync(config).ino).toBe(before);
    });

    it("retries a held lock and succeeds once it is released", () => {
        git("config", "merge.x.driver", "old");
        fs.writeFileSync(lock, "");
        const waits: number[] = [];
        const outcome = ensureGitConfig("merge.x.driver", "new", {
            cwd: repo,
            sleep: (ms) => {
                waits.push(ms);
                // The sibling finishes its write during our second wait.
                if (waits.length === 2) fs.rmSync(lock);
            },
        });
        expect(outcome).toBe("written");
        expect(waits).toEqual([50, 100]);
        expect(git("config", "--get", "merge.x.driver")).toBe("new");
    });

    it("stops retrying when a sibling wrote the wanted value meanwhile", () => {
        git("config", "merge.x.driver", "old");
        fs.writeFileSync(lock, "");
        const config = path.join(repo, ".git", "config");
        let slept = 0;
        const outcome = ensureGitConfig("merge.x.driver", "new", {
            cwd: repo,
            sleep: () => {
                slept++;
                // The sibling, still holding the lock, lands the same value.
                const text = fs.readFileSync(config, "utf8");
                fs.writeFileSync(config, text.replace("= old", "= new"));
            },
        });
        expect(outcome).toBe("present");
        expect(slept).toBe(1);
    });

    it("fails naming the lock after the bound", () => {
        fs.writeFileSync(lock, "");
        let slept = 0;
        expect(() =>
            ensureGitConfig("merge.x.driver", "cmd", {
                cwd: repo,
                attempts: 3,
                sleep: () => slept++,
            })
        ).toThrow(/config lock still held after 3 attempts/);
        expect(slept).toBe(2);
    });

    it("rethrows a failure that is not a lock collision, without retrying", () => {
        let slept = 0;
        expect(() =>
            ensureGitConfig("not-a-valid-key", "v", {
                cwd: repo,
                sleep: () => slept++,
            })
        ).toThrow(/git config not-a-valid-key failed/);
        expect(slept).toBe(0);
    });
});
