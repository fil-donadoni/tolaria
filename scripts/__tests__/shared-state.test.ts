import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    SHARED_STATE_NAMESPACE,
    SharedStateConflict,
    entryName,
    isLeaseRejection,
    leaseArg,
    readSharedState,
    stateRef,
    treeWith,
    writeSharedState,
} from "../lib/shared-state";

/**
 * Pipeline state as git refs on origin (issue #5873): what one machine
 * writes, the other reads; a write over a moved ref is refused; each key
 * owns its ref, so the keys never spoil each other's lease.
 */

describe("shared-state.ts — the pure parts", () => {
    it("treeWith adds a key, replaces it, keeps the others", () => {
        const a = "100644 blob aaaa\thousekeeping.json";
        const b = "100644 blob bbbb\tnightly.json";
        expect(treeWith("", "housekeeping.json", "aaaa")).toBe(`${a}\n`);
        expect(treeWith(`${a}\n`, "nightly.json", "bbbb")).toBe(`${a}\n${b}\n`);
        expect(treeWith(`${a}\n${b}\n`, "housekeeping.json", "cccc")).toBe(
            `${b}\n100644 blob cccc\thousekeeping.json\n`
        );
    });

    it("a lease names the key's own ref and the sha read, or an absent ref; a key is a plain slug", () => {
        expect(stateRef("housekeeping")).toBe(
            `${SHARED_STATE_NAMESPACE}/housekeeping`
        );
        expect(leaseArg("housekeeping", "abc")).toBe(
            `--force-with-lease=${SHARED_STATE_NAMESPACE}/housekeeping:abc`
        );
        expect(leaseArg("nightly", null)).toBe(
            `--force-with-lease=${SHARED_STATE_NAMESPACE}/nightly:`
        );
        expect(entryName("housekeeping")).toBe("housekeeping.json");
        expect(() => entryName("../etc")).toThrow(/not \[a-z\]/);
        expect(() => stateRef("Nightly")).toThrow(/not \[a-z\]/);
        expect(isLeaseRejection(" ! [rejected] x -> y (stale info)")).toBe(
            true
        );
        expect(isLeaseRejection("fatal: unable to access origin")).toBe(false);
    });
});

describe("shared-state.ts — against a bare origin, two machines", () => {
    let dir: string;
    const git = (args: string[], cwd: string) =>
        spawnSync("git", args, { cwd, encoding: "utf8" });

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "shared-state-"));
        git(["init", "-q", "--bare", "-b", "staging", "origin.git"], dir);
        git(["clone", "-q", "origin.git", "a"], dir);
        git(["clone", "-q", "origin.git", "b"], dir);
        // The refs sit beside the base branch, which is unaffected.
        const a = join(dir, "a");
        git(["config", "user.email", "t@t"], a);
        git(["config", "user.name", "t"], a);
        writeFileSync(join(a, "f"), "f");
        git(["add", "."], a);
        git(["commit", "-qm", "f"], a);
        git(["push", "-q", "origin", "HEAD:staging"], a);
    });
    afterEach(() =>
        rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        })
    );

    it("an empty store reads as no ref; a write on machine A is read on machine B; each key is its own ref", () => {
        const a = join(dir, "a");
        const b = join(dir, "b");
        expect(readSharedState(a, "housekeeping")).toEqual({
            sha: null,
            raw: null,
        });
        const sha1 = writeSharedState(a, "housekeeping", '{"since":1}', null);
        expect(readSharedState(b, "housekeeping")).toEqual({
            sha: sha1,
            raw: '{"since":1}',
        });
        // Another key, written from B with ITS lease (none yet), leaves A's
        // document intact and never needed A's sha.
        const sha2 = writeSharedState(b, "nightly", '{"n":1}', null);
        expect(sha2).not.toBe(sha1);
        expect(readSharedState(a, "housekeeping")).toEqual({
            sha: sha1,
            raw: '{"since":1}',
        });
        expect(readSharedState(a, "nightly")).toEqual({
            sha: sha2,
            raw: '{"n":1}',
        });
        expect(readSharedState(a, "other")).toEqual({ sha: null, raw: null });
        expect(
            git(["ls-remote", "origin", `${SHARED_STATE_NAMESPACE}/*`], a)
                .stdout.trim()
                .split("\n")
        ).toHaveLength(2);
        // The base branch never moved.
        expect(git(["rev-parse", "origin/staging"], a).stdout).toBe(
            git(["rev-parse", "HEAD"], a).stdout
        );
    });

    it("a write over a ref that moved since it was read is refused, and the newer document stands", () => {
        const a = join(dir, "a");
        const b = join(dir, "b");
        const first = readSharedState(b, "housekeeping"); // null: no ref
        const shaA = writeSharedState(a, "housekeeping", '{"since":1}', null);
        expect(() =>
            writeSharedState(b, "housekeeping", '{"since":0}', first.sha)
        ).toThrow(SharedStateConflict);
        expect(readSharedState(b, "housekeeping")).toEqual({
            sha: shaA,
            raw: '{"since":1}',
        });
        // Re-read, then the write goes through.
        const again = readSharedState(b, "housekeeping");
        writeSharedState(b, "housekeeping", '{"since":2}', again.sha);
        expect(readSharedState(a, "housekeeping").raw).toBe('{"since":2}');
    });

    it("a six-hour nightly interleaved with hourly housekeeping writes: neither key's lease is spoiled by the other (review of PR #5905)", () => {
        const a = join(dir, "a"); // the nightly's machine
        const b = join(dir, "b"); // housekeeping's machine
        const night = readSharedState(a, "nightly"); // 03:40, before any write
        const hk0 = readSharedState(b, "housekeeping");
        // Housekeeping writes at 04:17, 05:17, 06:17 while the nightly runs.
        let lease = hk0.sha;
        for (const h of [4, 5, 6])
            lease = writeSharedState(
                b,
                "housekeeping",
                `{"since":${h}}`,
                lease
            );
        // The nightly's record, written with the lease it read at 03:40.
        const n1 = writeSharedState(
            a,
            "nightly",
            '{"refreshedSha":"x"}',
            night.sha
        );
        expect(readSharedState(b, "nightly")).toEqual({
            sha: n1,
            raw: '{"refreshedSha":"x"}',
        });
        expect(readSharedState(a, "housekeeping").raw).toBe('{"since":6}');
        // And the nightly's own second write still needs ITS fresh lease.
        expect(() =>
            writeSharedState(a, "nightly", '{"refreshedSha":"y"}', night.sha)
        ).toThrow(SharedStateConflict);
        writeSharedState(a, "nightly", '{"refreshedSha":"y"}', n1);
    });
});
