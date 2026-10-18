import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ALLOWLIST_PATH } from "../check-gaps";
import { ALLOWLIST_COMMIT_SUBJECT } from "../gaps-sync";
import { BASE_BRANCH } from "../lib/branches";
import {
    cardSetsChanged,
    cwdInside,
    mergedPrNumbers,
    mergedWorktree,
    pushRange,
    seedPlan,
    syncNotice,
} from "../lib/post-merge";
import { fastForward, strandedAllowlistOnly } from "../post-merge";

describe("strandedAllowlistOnly (issue #5873)", () => {
    it("is true only for gaps:sync's own allowlist commits, all of them", () => {
        const sync = {
            subject: ALLOWLIST_COMMIT_SUBJECT,
            files: [ALLOWLIST_PATH],
        };
        expect(strandedAllowlistOnly([sync])).toBe(true);
        expect(strandedAllowlistOnly([sync, sync])).toBe(true);
        expect(strandedAllowlistOnly([])).toBe(false);
        expect(
            strandedAllowlistOnly([sync, { subject: "wip", files: ["a.ts"] }])
        ).toBe(false);
        expect(
            strandedAllowlistOnly([
                { ...sync, files: [ALLOWLIST_PATH, "a.ts"] },
            ])
        ).toBe(false);
        expect(
            strandedAllowlistOnly([{ ...sync, subject: "gaps:sync — other" }])
        ).toBe(false);
    });
});

describe("syncNotice (issue #5873)", () => {
    it("a green leg has none; a red one is keyed by its failing steps, so notifyOnce sends each distinct failure once", () => {
        expect(syncNotice([], "h")).toBeNull();
        expect(syncNotice(["fast-forward of /p"], "huawei")).toEqual({
            key: "fast-forward of /p",
            message: "post-merge sync red on huawei: fast-forward of /p",
        });
        expect(
            syncNotice(["fast-forward of /p", "telemetry ingest"], "huawei")!
                .key
        ).toBe("fast-forward of /p; telemetry ingest");
    });
});

describe("pushRange", () => {
    it("is before..after for a push onto an existing branch", () => {
        expect(pushRange("a1", "b2")).toBe("a1..b2");
    });
    it("is the tip alone when the push created the branch", () => {
        expect(pushRange("0".repeat(40), "b2")).toBe("b2~1..b2");
    });
});

describe("mergedPrNumbers", () => {
    it("reads the squash suffix, oldest first, once each", () => {
        expect(
            mergedPrNumbers([
                "feat: a (issue #5) (#12)",
                "gaps:sync allowlist",
                "fix: b (#9)",
                "again (#12)",
            ])
        ).toEqual([12, 9]);
    });
    it("ignores a number that is not the subject's suffix", () => {
        expect(mergedPrNumbers(["see #12 for why", "(#7) first"])).toEqual([]);
    });
});

describe("cardSetsChanged", () => {
    it("fires on a file under convex/cards/sets/", () => {
        expect(cardSetsChanged(["a.ts", "convex/cards/sets/ice.ts"])).toBe(
            true
        );
    });
    it("does not fire on the card engine beside it", () => {
        expect(cardSetsChanged(["convex/cards/types.ts"])).toBe(false);
    });
});

describe("mergedWorktree", () => {
    it("derives the wt:new path from the head branch", () => {
        expect(mergedWorktree("/w/tolaria", "feat/issue-5644")).toBe(
            "/w/tolaria-issue-5644"
        );
        expect(mergedWorktree("/w/tolaria", "fix/issue-7")).toBe(
            "/w/tolaria-issue-7"
        );
    });
    it("is null for a branch naming no issue", () => {
        expect(mergedWorktree("/w/tolaria", "hand-made-branch")).toBeNull();
    });
});

describe("cwdInside", () => {
    const out = "p1\nn/w/other\np2\nn/w/tolaria-issue-5/convex";
    it("is true for a process working under the directory", () => {
        expect(cwdInside(out, "/w/tolaria-issue-5")).toBe(true);
    });
    it("is false for a sibling sharing the prefix", () => {
        expect(cwdInside("n/w/tolaria-issue-50/x", "/w/tolaria-issue-5")).toBe(
            false
        );
        expect(cwdInside(out, "/w/tolaria-issue-50")).toBe(false);
        expect(cwdInside("n/w/tolaria-issue-5", "/w/tolaria-issue-50")).toBe(
            false
        );
    });
});

describe("seedPlan", () => {
    it("seeds every PR and the presets when a set changed", () => {
        expect(seedPlan(true, [3, 4], ["convex/cards/sets/x.ts"])).toEqual({
            scenarios: [3, 4],
            presets: true,
        });
    });
    it("reseeds no presets without a set change", () => {
        expect(seedPlan(true, [3], ["src/a.tsx"]).presets).toBe(false);
    });
    it("seeds nothing after a failed fast-forward", () => {
        expect(seedPlan(false, [3], ["convex/cards/sets/x.ts"])).toEqual({
            scenarios: [],
            presets: false,
        });
    });
});

describe("fastForward", () => {
    let dir: string;
    const git = (args: string[], cwd: string) =>
        spawnSync("git", args, { cwd, encoding: "utf8" });

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "post-merge-"));
        git(["init", "-q", "--bare", "-b", BASE_BRANCH, "origin.git"], dir);
        git(["clone", "-q", "origin.git", "primary"], dir);
        git(["clone", "-q", "origin.git", "pusher"], dir);
        for (const [who, file] of [
            ["primary", "a"],
            ["pusher", "b"],
        ]) {
            const cwd = join(dir, who);
            git(["config", "user.email", "t@t"], cwd);
            git(["config", "user.name", "t"], cwd);
            git(["checkout", "-q", "-B", BASE_BRANCH], cwd);
            writeFileSync(join(cwd, file), file);
            git(["add", "."], cwd);
            git(["commit", "-qm", file], cwd);
        }
        git(["push", "-q", "origin", BASE_BRANCH], join(dir, "primary"));
        git(["fetch", "-q"], join(dir, "pusher"));
        git(
            ["reset", "-q", "--hard", `origin/${BASE_BRANCH}`],
            join(dir, "pusher")
        );
        writeFileSync(join(dir, "pusher", "c"), "c");
        git(["add", "."], join(dir, "pusher"));
        git(["commit", "-qm", "c"], join(dir, "pusher"));
        git(["push", "-q", "origin", BASE_BRANCH], join(dir, "pusher"));
    });
    afterEach(() =>
        rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        })
    );

    it("moves the base branch onto the pushed tip", () => {
        const primary = join(dir, "primary");
        expect(fastForward(primary)).toBe(true);
        expect(git(["rev-parse", "HEAD"], primary).stdout).toBe(
            git(["rev-parse", `origin/${BASE_BRANCH}`], primary).stdout
        );
    });

    it("heals a primary whose only divergence is stranded gaps:sync allowlist commits (issue #5873)", () => {
        const primary = join(dir, "primary");
        mkdirSync(join(primary, dirname(ALLOWLIST_PATH)), { recursive: true });
        writeFileSync(join(primary, ALLOWLIST_PATH), "{}");
        git(["add", "--", ALLOWLIST_PATH], primary);
        git(
            ["commit", "-qm", ALLOWLIST_COMMIT_SUBJECT, "--", ALLOWLIST_PATH],
            primary
        );
        // Diverged for real: the base moved under it (fetched), the local
        // commit is not on it.
        git(["fetch", "-q"], primary);
        expect(
            git(["merge", "--ff-only", `origin/${BASE_BRANCH}`], primary).status
        ).not.toBe(0);
        expect(fastForward(primary)).toBe(true);
        expect(git(["rev-parse", "HEAD"], primary).stdout).toBe(
            git(["rev-parse", `origin/${BASE_BRANCH}`], primary).stdout
        );
        expect(
            git(
                ["rev-list", `origin/${BASE_BRANCH}..HEAD`],
                primary
            ).stdout.trim()
        ).toBe("");
    });

    it("refuses — and leaves standing — any other local commit", () => {
        const primary = join(dir, "primary");
        writeFileSync(join(primary, "wip.ts"), "x");
        git(["add", "."], primary);
        git(["commit", "-qm", "wip"], primary);
        const before = git(["rev-parse", "HEAD"], primary).stdout;
        expect(fastForward(primary)).toBe(false);
        expect(git(["rev-parse", "HEAD"], primary).stdout).toBe(before);
    });

    it("leaves a checkout on another branch alone", () => {
        const primary = join(dir, "primary");
        git(["checkout", "-q", "-b", "wip"], primary);
        const before = git(["rev-parse", "HEAD"], primary).stdout;
        expect(fastForward(primary)).toBe(false);
        expect(git(["rev-parse", "HEAD"], primary).stdout).toBe(before);
    });
});
