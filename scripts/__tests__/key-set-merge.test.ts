import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mergeKeySets, serializeKeys } from "../lib/key-set-merge";
import { KEY_SET_MERGE_DRIVER_NAME } from "../lib/generated-artifacts";
import { BASE_BRANCH } from "../lib/branches";

/**
 * Guards for issue #6276 — the issue-log ratchet baseline is merged as a set of
 * keys, so adjacent or overlapping deletions (PR #6255's shape) never conflict.
 */

const REPO_ROOT = resolve(__dirname, "..", "..");
const DRIVER = join(REPO_ROOT, "scripts", "merge-driver-key-set.ts");
const FILE = "baseline.json";
const text = (...keys: string[]) => serializeKeys(keys);

describe("mergeKeySets (pure)", () => {
    it("overlapping deletions on both sides: [a,b,c,d] minus b / minus b,c → [a,d]", () => {
        const r = mergeKeySets(
            text("a", "b", "c", "d"),
            text("a", "c", "d"),
            text("a", "d")
        );
        expect(r).toEqual({ ok: true, keys: ["a", "d"] });
    });

    it("disjoint additions are unioned and sorted", () => {
        const r = mergeKeySets(text("b"), text("b", "z"), text("a", "b"));
        expect(r).toEqual({ ok: true, keys: ["a", "b", "z"] });
    });

    it("an addition on one side and a removal on the other both apply", () => {
        const r = mergeKeySets(text("a", "b"), text("a", "b", "c"), text("a"));
        expect(r).toEqual({ ok: true, keys: ["a", "c"] });
    });

    it("an empty base (add/add) reads as an empty set", () => {
        expect(mergeKeySets("", text("a"), text("b"))).toEqual({
            ok: true,
            keys: ["a", "b"],
        });
    });

    it.each(["base", "ours", "theirs"] as const)(
        "malformed JSON on the %s side is an error",
        (side) => {
            const sides = {
                base: text("a"),
                ours: text("a"),
                theirs: text("a"),
            };
            sides[side] = "[ not json";
            const r = mergeKeySets(sides.base, sides.ours, sides.theirs);
            expect(r.ok).toBe(false);
        }
    );

    it("a non-array or non-string payload is an error", () => {
        expect(mergeKeySets("[]", '{"a":1}', "[]").ok).toBe(false);
        expect(mergeKeySets("[]", "[1]", "[]").ok).toBe(false);
    });
});

describe("key-set merge driver (real git)", () => {
    let dir: string;
    let repo: string;

    function git(args: string[]): string {
        const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
        if (r.status !== 0) {
            throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
        }
        return r.stdout.trim();
    }
    const commit = (message: string) => {
        git(["add", "-A"]);
        git(["commit", "-m", message]);
    };

    function useDriver(): void {
        writeFileSync(
            join(repo, ".gitattributes"),
            `${FILE} merge=${KEY_SET_MERGE_DRIVER_NAME}\n`
        );
        commit("gitattributes");
        git(["config", `merge.${KEY_SET_MERGE_DRIVER_NAME}.name`, "key-set"]);
        git([
            "config",
            `merge.${KEY_SET_MERGE_DRIVER_NAME}.driver`,
            `bun ${DRIVER} %O %A %B %P`,
        ]);
    }

    function divergeAndRebase(branch: string, main: string) {
        git(["checkout", "-q", "-b", "branch"]);
        writeFileSync(join(repo, FILE), branch);
        commit("branch deletes");
        git(["checkout", "-q", BASE_BRANCH]);
        writeFileSync(join(repo, FILE), main);
        commit("main deletes");
        git(["checkout", "-q", "branch"]);
        const r = spawnSync("git", ["rebase", BASE_BRANCH], {
            cwd: repo,
            encoding: "utf8",
        });
        return { status: r.status, output: r.stdout + r.stderr };
    }

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tolaria-key-set-merge-"));
        repo = join(dir, "repo");
        mkdirSync(repo, { recursive: true });
        spawnSync("git", ["init", "-b", BASE_BRANCH, repo], { cwd: dir });
        git(["config", "user.email", "test@example.com"]);
        git(["config", "user.name", "Test"]);
        writeFileSync(join(repo, FILE), text("a", "b", "c", "d"));
        commit("base");
    });

    afterEach(() => {
        rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        });
    });

    it("WITHOUT the driver, adjacent deletions conflict (the bug)", () => {
        const r = divergeAndRebase(text("a", "d"), text("a", "c", "d"));
        expect(r.status).not.toBe(0);
        spawnSync("git", ["rebase", "--abort"], { cwd: repo });
    });

    it("with the driver, the same rebase is clean and canonical", () => {
        useDriver();
        const r = divergeAndRebase(text("a", "d"), text("a", "c", "d"));
        expect(r.status, r.output).toBe(0);
        expect(readFileSync(join(repo, FILE), "utf8")).toBe(text("a", "d"));
    });

    it("with the driver, a malformed side stays a conflict", () => {
        useDriver();
        const r = divergeAndRebase("[ broken", text("a", "c", "d"));
        expect(r.status).not.toBe(0);
        spawnSync("git", ["rebase", "--abort"], { cwd: repo });
    });
});
