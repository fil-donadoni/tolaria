import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ALLOWLIST_PATH } from "../check-gaps";
import { ALLOWLIST_COMMIT_SUBJECT } from "../gaps-sync";
import { BASE_BRANCH } from "../lib/branches";
import {
    deriveCommitAmong,
    cardSetsChanged,
    cwdInside,
    mergedPrNumbers,
    mergedWorktree,
    pushRange,
    seedPlan,
    syncNotice,
} from "../lib/post-merge";
import {
    CARD_INDEX_PATH,
    DERIVED_PATHS,
    DERIVE_SYNC_COMMIT_SUBJECT,
} from "../lib/derive-sync";
import {
    seed,
    awaitDeriveCommit,
    fastForward,
    fastForwardRefusal,
    gitErrorLine,
    removeMergedWorktree,
    strandedAllowlistOnly,
    syncSteps,
    tipHeldLine,
    type MergedWorktreeIo,
    type SyncIo,
} from "../post-merge";

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

describe("fastForwardRefusal (issue #6018)", () => {
    const untracked =
        "error: The following untracked working tree files would be overwritten by merge:\n\tc\nPlease move or remove them before you merge.\nAborting";

    it("reports git's own line, never 'diverged', when HEAD is on the base", () => {
        const msg = fastForwardRefusal({
            gitError: untracked,
            headOnBase: true,
            local: [],
        });
        expect(msg).not.toMatch(/diverged/);
        expect(msg).toContain(
            "git: error: The following untracked working tree files would be overwritten by merge:"
        );
    });

    it("says 'diverged' when HEAD is not an ancestor of the base, naming the local commits", () => {
        const msg = fastForwardRefusal({
            gitError: "fatal: Not possible to fast-forward, aborting.",
            headOnBase: false,
            local: [{ subject: "wip" }],
        });
        expect(msg).toMatch(/^it diverged from the base/);
        expect(msg).toContain('1 local commit(s) not on the base: "wip"');
        expect(msg).toContain(
            "git: fatal: Not possible to fast-forward, aborting."
        );
    });

    it("gitErrorLine takes the first non-blank line, with a fallback for silence", () => {
        expect(gitErrorLine("\n  fatal: x\nmore")).toBe("fatal: x");
        expect(gitErrorLine("")).toBe("git printed no error");
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
    it("reads a head branch as `gh()` prints it, trailing newline and all (issue #6083)", () => {
        // `gh()` keeps the newline; `issue-(\d+)$` did not match before it, so
        // every merged PR's worktree was silently skipped.
        expect(mergedWorktree("/w/tolaria", "fix/issue-6066\n")).toBe(
            "/w/tolaria-issue-6066"
        );
    });
    it("is null for a branch naming no issue", () => {
        expect(mergedWorktree("/w/tolaria", "hand-made-branch")).toBeNull();
    });
});

describe("removeMergedWorktree (issue #6083)", () => {
    const io = (head: string, exists = true) => {
        const lines: string[] = [];
        const calls: string[][] = [];
        const fake: MergedWorktreeIo = {
            headOf: () => head,
            exists: () => exists,
            cwds: () => "",
            git: (args) => {
                calls.push(args);
                return { ok: true };
            },
            log: (l) => lines.push(l),
        };
        return { fake, lines, calls };
    };

    it("removes the issue worktree of a head branch read with its trailing newline", () => {
        const { fake, lines, calls } = io("fix/issue-6066\n");
        expect(removeMergedWorktree("/w/tolaria", 6074, fake)).toBe(true);
        expect(calls).toContainEqual([
            "worktree",
            "remove",
            "--force",
            "/w/tolaria-issue-6066",
        ]);
        expect(lines).toEqual([
            "post-merge: PR #6074: worktree /w/tolaria-issue-6066 removed",
        ]);
    });

    it("logs a branch that maps to no issue worktree — never a silent success", () => {
        const { fake, lines, calls } = io("chore/some-slug\n");
        expect(removeMergedWorktree("/w/tolaria", 7, fake)).toBe(true);
        expect(calls).toEqual([]);
        expect(lines).toEqual([
            'post-merge: PR #7: head branch "chore/some-slug" maps to no issue worktree — nothing to remove',
        ]);
    });

    it("logs a worktree this machine does not hold", () => {
        const { fake, lines } = io("feat/issue-9", false);
        expect(removeMergedWorktree("/w/tolaria", 8, fake)).toBe(true);
        expect(lines).toEqual([
            "post-merge: PR #8: worktree /w/tolaria-issue-9 not on this machine",
        ]);
    });

    it("is red when the head branch cannot be read", () => {
        const { fake } = io("");
        fake.headOf = () => {
            throw new Error("gh: HTTP 502");
        };
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(removeMergedWorktree("/w/tolaria", 9, fake)).toBe(false);
        err.mockRestore();
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

    it("names git's refusal, not 'diverged', when an untracked file blocks a clean fast-forward (issue #6018)", () => {
        const primary = join(dir, "primary");
        writeFileSync(join(primary, "c"), "in the way");
        const errors: string[] = [];
        const spy = vi
            .spyOn(console, "error")
            .mockImplementation((m: string) => void errors.push(m));
        try {
            expect(fastForward(primary)).toBe(false);
        } finally {
            spy.mockRestore();
        }
        expect(errors.join("\n")).not.toMatch(/diverged/);
        expect(errors.join("\n")).toMatch(/untracked working tree files/);
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

    /** The pusher lands one more commit `d` after `c`; returns `c`'s sha. */
    const pushD = (): string => {
        const pusher = join(dir, "pusher");
        const c = git(["rev-parse", "HEAD"], pusher).stdout.trim();
        writeFileSync(join(pusher, "d"), "d");
        git(["add", "."], pusher);
        git(["commit", "-qm", "d"], pusher);
        git(["push", "-q", "origin", BASE_BRANCH], pusher);
        return c;
    };

    it("fast-forwards to the GIVEN tip, not past it (ADR 0157, issue #6247)", () => {
        const primary = join(dir, "primary");
        const c = pushD();
        expect(fastForward(primary, c)).toBe(true);
        expect(git(["rev-parse", "HEAD"], primary).stdout.trim()).toBe(c);
        expect(git(["rev-parse", "HEAD"], primary).stdout).not.toBe(
            git(["rev-parse", `origin/${BASE_BRANCH}`], primary).stdout
        );
    });

    describe("syncSteps — the derived-fresh predicate decides the move (ADR 0157 § Option 1b)", () => {
        const io = (judge: SyncIo["judge"]): SyncIo => ({
            judge,
            ingest: () => true,
            removeWorktree: () => true,
        });
        const quiet = () => {
            const spy = vi.spyOn(console, "log").mockImplementation(() => {});
            return () => spy.mockRestore();
        };

        it("a derived-stale tip holds the primary where it is — and is not a failed step", () => {
            const primary = join(dir, "primary");
            const before = git(["rev-parse", "HEAD"], primary).stdout.trim();
            const after = git(
                ["rev-parse", "HEAD"],
                join(dir, "pusher")
            ).stdout.trim();
            const restore = quiet();
            try {
                expect(
                    syncSteps(
                        primary,
                        before,
                        after,
                        io(() => ({ kind: "stale", why: "header drift" }))
                    )
                ).toEqual([]);
            } finally {
                restore();
            }
            expect(git(["rev-parse", "HEAD"], primary).stdout.trim()).toBe(
                before
            );
        });

        it("a derived-fresh tip is fast-forwarded to", () => {
            const primary = join(dir, "primary");
            const before = git(["rev-parse", "HEAD"], primary).stdout.trim();
            const after = git(
                ["rev-parse", "HEAD"],
                join(dir, "pusher")
            ).stdout.trim();
            expect(
                syncSteps(
                    primary,
                    before,
                    after,
                    io(() => ({ kind: "fresh" }))
                )
            ).toEqual([]);
            expect(git(["rev-parse", "HEAD"], primary).stdout.trim()).toBe(
                after
            );
        });

        it("tipHeldLine: silent on fresh, says 'regardless' on unjudged, names the stale reason and the ADR", () => {
            expect(tipHeldLine("abc", "/p", { kind: "fresh" })).toBeNull();
            expect(
                tipHeldLine("abcdef0123456789", "/p", {
                    kind: "unjudged",
                    why: "elsewhere",
                })
            ).toMatch(/abcdef0123 .*elsewhere.*regardless/);
            expect(
                tipHeldLine("abcdef0123456789", "/p", {
                    kind: "stale",
                    why: "header drift",
                })
            ).toMatch(/derived-stale \(header drift\) — \/p stays .*ADR 0157/);
        });
    });
});

describe("deriveCommitAmong — the derive commit the seed waits for (ADR 0157, issue #6248)", () => {
    it("the first derive:sync commit whose files are derived paths only", () => {
        expect(
            deriveCommitAmong([
                { sha: "a", subject: "feat: x (#1)", files: ["src/a.ts"] },
                {
                    sha: "b",
                    subject: DERIVE_SYNC_COMMIT_SUBJECT,
                    files: [DERIVED_PATHS[0]!, DERIVED_PATHS[2]!],
                },
                {
                    sha: "c",
                    subject: DERIVE_SYNC_COMMIT_SUBJECT,
                    files: [DERIVED_PATHS[1]!],
                },
            ])
        ).toBe("b");
    });

    it("a derive commit carrying the card index its drift sweep wrote is it (issue #6687)", () => {
        expect(
            deriveCommitAmong([
                {
                    sha: "d",
                    subject: DERIVE_SYNC_COMMIT_SUBJECT,
                    files: [DERIVED_PATHS[0]!, CARD_INDEX_PATH],
                },
            ])
        ).toBe("d");
    });

    it("null with none yet; a foreign file or no file under the subject is not it", () => {
        expect(deriveCommitAmong([])).toBeNull();
        expect(
            deriveCommitAmong([
                {
                    sha: "a",
                    subject: "feat: y (#2)",
                    files: [DERIVED_PATHS[0]!],
                },
                { sha: "b", subject: DERIVE_SYNC_COMMIT_SUBJECT, files: [] },
                {
                    sha: "c",
                    subject: DERIVE_SYNC_COMMIT_SUBJECT,
                    files: [DERIVED_PATHS[0]!, "src/a.ts"],
                },
            ])
        ).toBeNull();
    });
});

describe("seed — a stale tip waits for derive:sync's commit and fast-forwards to it (ADR 0157, issue #6248)", () => {
    let dir: string;
    const git = (args: string[], cwd: string) =>
        spawnSync("git", args, { cwd, encoding: "utf8" });
    const quiet = () => {
        const spies = [
            vi.spyOn(console, "log").mockImplementation(() => {}),
            vi.spyOn(console, "error").mockImplementation(() => {}),
        ];
        return () => spies.forEach((s) => s.mockRestore());
    };

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "post-merge-seed-"));
        git(["init", "-q", "--bare", "-b", BASE_BRANCH, "origin.git"], dir);
        git(["clone", "-q", "origin.git", "primary"], dir);
        git(["clone", "-q", "origin.git", "pusher"], dir);
        for (const who of ["primary", "pusher"]) {
            const cwd = join(dir, who);
            git(["config", "user.email", "t@t"], cwd);
            git(["config", "user.name", "t"], cwd);
            git(["checkout", "-q", "-B", BASE_BRANCH], cwd);
        }
        const primary = join(dir, "primary");
        writeFileSync(join(primary, "a"), "a");
        git(["add", "."], primary);
        git(["commit", "-qm", "a"], primary);
        git(["push", "-q", "origin", BASE_BRANCH], primary);
    });
    afterEach(() =>
        rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        })
    );

    /** The pusher lands a commit on the base and returns its sha. */
    const push = (file: string, subject: string): string => {
        const pusher = join(dir, "pusher");
        git(["fetch", "-q"], pusher);
        git(["reset", "-q", "--hard", `origin/${BASE_BRANCH}`], pusher);
        mkdirSync(dirname(join(pusher, file)), { recursive: true });
        writeFileSync(join(pusher, file), subject);
        git(["add", "."], pusher);
        git(["commit", "-qm", subject], pusher);
        git(["push", "-q", "origin", BASE_BRANCH], pusher);
        return git(["rev-parse", "HEAD"], pusher).stdout.trim();
    };

    it("fast-forwards the primary to the derive commit, not to the stale tip", () => {
        const primary = join(dir, "primary");
        const before = git(["rev-parse", "HEAD"], primary).stdout.trim();
        // No PR number: the fixture has no seed scripts to run after the move.
        const after = push("src/card.ts", "feat: a card");
        const derive = push(DERIVED_PATHS[0]!, DERIVE_SYNC_COMMIT_SUBJECT);
        const asked: string[] = [];
        const restore = quiet();
        try {
            expect(
                seed(primary, before, after, {
                    judge: () => ({ kind: "stale", why: "header drift" }),
                    deriveCommit: (sha) => {
                        asked.push(sha);
                        return awaitDeriveCommit(sha, primary, { waitMs: 0 });
                    },
                })
            ).toBe(true);
        } finally {
            restore();
        }
        expect(asked).toEqual([after]);
        expect(git(["rev-parse", "HEAD"], primary).stdout.trim()).toBe(derive);
    });

    it("no derive commit within the wait: red, the primary unmoved, seeding left to a hand", () => {
        const primary = join(dir, "primary");
        const before = git(["rev-parse", "HEAD"], primary).stdout.trim();
        const after = push("src/card.ts", "feat: a card (#7)");
        push("src/other.ts", "feat: another (#8)");
        const lines: string[] = [];
        const spy = vi
            .spyOn(console, "error")
            .mockImplementation((l) => void lines.push(String(l)));
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        try {
            expect(
                seed(primary, before, after, {
                    judge: () => ({ kind: "stale", why: "header drift" }),
                    deriveCommit: (sha) =>
                        awaitDeriveCommit(sha, primary, { waitMs: 0 }),
                })
            ).toBe(false);
        } finally {
            spy.mockRestore();
            log.mockRestore();
        }
        expect(git(["rev-parse", "HEAD"], primary).stdout.trim()).toBe(before);
        expect(lines.join("\n")).toContain("no derive:sync commit on top of");
        expect(lines.join("\n")).toContain("#7");
    });

    it("a fresh tip is fast-forwarded to as before, without asking for a derive commit", () => {
        const primary = join(dir, "primary");
        const before = git(["rev-parse", "HEAD"], primary).stdout.trim();
        const after = push("src/card.ts", "feat: a card (#7)");
        let asked = 0;
        const restore = quiet();
        try {
            seed(primary, before, after, {
                judge: () => ({ kind: "fresh" }),
                deriveCommit: () => {
                    asked += 1;
                    return null;
                },
            });
        } finally {
            restore();
        }
        expect(asked).toBe(0);
        expect(git(["rev-parse", "HEAD"], primary).stdout.trim()).toBe(after);
    });
});
