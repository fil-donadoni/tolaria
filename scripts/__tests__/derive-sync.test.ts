/**
 * `derive:sync` — the base writes its derived whole-file state (ADR 0157
 * § Option 1b, issue #6247): the decisions of `lib/derive-sync.ts`, the
 * scratch-index commit of `lib/commit-tree.ts` against a real repository,
 * and the pins that keep the leaf's literals equal to their owners'.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCKFILE_PATH as CHECK_GAPS_LOCKFILE_PATH } from "../check-gaps";
import { CATALOGUE_DIR, SOURCE_HASH_FILE } from "../lib/catalogue-merge";
import { commitOnScratchIndex } from "../lib/commit-tree";
import { DEFINITION_INDEX_PATH } from "../lib/definition-index";
import {
    DERIVED_PATHS,
    DERIVE_SYNC_COMMIT_SUBJECT,
    LOCKFILE_PATH,
    derivePlan,
    derivedFreshness,
    pushOutcome,
} from "../lib/derive-sync";
import { PACKED_CORPUS_PATH } from "../lib/packed-corpus";
import { SEARCH_INDEX_PATH } from "../lib/search-index";
import { DERIVE_SYNC_STEP } from "../housekeeping";

describe("derive-sync.ts — the five derived paths are their owners' (ADR 0157)", () => {
    it("pins the leaf's literals to the constants the generators write", () => {
        expect(LOCKFILE_PATH).toBe(CHECK_GAPS_LOCKFILE_PATH);
        expect([...DERIVED_PATHS]).toEqual([
            LOCKFILE_PATH,
            join(CATALOGUE_DIR, SOURCE_HASH_FILE),
            PACKED_CORPUS_PATH,
            DEFINITION_INDEX_PATH,
            SEARCH_INDEX_PATH,
        ]);
    });

    it("housekeeping's step runs this script, under its own label", () => {
        expect(DERIVE_SYNC_STEP.argv).toEqual([
            "bun",
            "scripts/derive-sync.ts",
        ]);
        expect(DERIVE_SYNC_STEP.label).toBe("derive:sync");
        expect(DERIVE_SYNC_STEP.timeoutMs).toBeGreaterThan(0);
    });
});

describe("derivePlan — tip state → commit / no-op", () => {
    const same = (path: string) => ({
        path,
        committed: `blob-${path}`,
        regenerated: `blob-${path}`,
    });

    it("is a no-op when every regenerated blob equals the tip's", () => {
        expect(derivePlan(DERIVED_PATHS.map(same))).toEqual({ kind: "no-op" });
        expect(derivePlan([])).toEqual({ kind: "no-op" });
    });

    it("commits exactly the paths that differ — a missing path included, an unchanged one never", () => {
        const entries = DERIVED_PATHS.map(same).map((e, i) =>
            i === 0
                ? { ...e, regenerated: "new-header" }
                : i === 2
                  ? { ...e, committed: null }
                  : e
        );
        expect(derivePlan(entries)).toEqual({
            kind: "commit",
            paths: [DERIVED_PATHS[0], DERIVED_PATHS[2]],
        });
    });

    it("refuses a path the writer does not own", () => {
        expect(() =>
            derivePlan([
                {
                    path: "data/card-index.json",
                    committed: "a",
                    regenerated: "b",
                },
            ])
        ).toThrow(/owns/);
    });
});

describe("pushOutcome — coalescing (ADR 0157 § Option 1b)", () => {
    it("landed when pushed; coalesced when refused and the base moved; failed when refused and the base stood", () => {
        expect(pushOutcome({ pushed: true, remoteMoved: false })).toBe(
            "landed"
        );
        expect(pushOutcome({ pushed: true, remoteMoved: true })).toBe("landed");
        expect(pushOutcome({ pushed: false, remoteMoved: true })).toBe(
            "coalesced"
        );
        expect(pushOutcome({ pushed: false, remoteMoved: false })).toBe(
            "failed"
        );
    });
});

describe("derivedFreshness — sync's derived-fresh predicate", () => {
    const catalogue = [
        { path: PACKED_CORPUS_PATH, committed: "packed", expected: "packed" },
        { path: SEARCH_INDEX_PATH, committed: "search", expected: "search" },
    ];

    it("a fresh fixture: no header drift, every catalogue file what the tree generates", () => {
        expect(derivedFreshness({ hashDrift: null, catalogue })).toEqual({
            fresh: true,
        });
    });

    it("a stale fixture: header drift is stale, naming the drift's first line", () => {
        const f = derivedFreshness({
            hashDrift:
                "compilerHash drift — the compiler source changed\n    header: a\n    tree: b",
            catalogue,
        });
        expect(f.fresh).toBe(false);
        expect(f).toMatchObject({
            why: "lockfile header: compilerHash drift — the compiler source changed",
        });
    });

    it("a stale fixture: a catalogue file that is not what the tree generates, or is missing", () => {
        expect(
            derivedFreshness({
                hashDrift: null,
                catalogue: [
                    ...catalogue,
                    {
                        path: DEFINITION_INDEX_PATH,
                        committed: "old",
                        expected: "new",
                    },
                ],
            })
        ).toEqual({
            fresh: false,
            why: `${DEFINITION_INDEX_PATH} is not what the tree generates`,
        });
        expect(
            derivedFreshness({
                hashDrift: null,
                catalogue: [
                    { path: SEARCH_INDEX_PATH, committed: null, expected: "s" },
                ],
            })
        ).toEqual({ fresh: false, why: `${SEARCH_INDEX_PATH} is missing` });
    });
});

describe("commitOnScratchIndex — a commit the checkout never sees (real git)", () => {
    let repo: string;
    const run = (args: string[], opts: { env?: NodeJS.ProcessEnv } = {}) => {
        const r = spawnSync("git", args, {
            cwd: repo,
            encoding: "utf8",
            env: opts.env,
        });
        return {
            status: r.status,
            stdout: r.stdout ?? "",
            stderr: r.stderr ?? "",
        };
    };
    const git = (...args: string[]): string => {
        const r = run(args);
        if (r.status !== 0)
            throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
        return r.stdout.trim();
    };

    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), "commit-tree-"));
        git("init", "-q", "-b", "main");
        git("config", "user.email", "t@example.com");
        git("config", "user.name", "t");
        git("config", "commit.gpgsign", "false");
        mkdirSync(join(repo, "data", "catalogue"), { recursive: true });
        writeFileSync(join(repo, "keep.txt"), "keep\n");
        writeFileSync(join(repo, DERIVED_PATHS[0]!), "old lockfile\n");
        writeFileSync(join(repo, DERIVED_PATHS[1]!), "old hash\n");
        git("add", ".");
        git("commit", "-q", "-m", "seed");
    });
    afterEach(() =>
        rmSync(repo, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        })
    );

    it("records the given blobs over the base tree, parented on it, and leaves the checkout's index and tree untouched", () => {
        const head = git("rev-parse", "HEAD");
        const write = (text: string): string => {
            const r = spawnSync("git", ["hash-object", "-w", "--stdin"], {
                cwd: repo,
                encoding: "utf8",
                input: text,
            });
            return r.stdout.trim();
        };
        const built = commitOnScratchIndex(
            run,
            head,
            [
                { path: DERIVED_PATHS[0]!, blob: write("new lockfile\n") },
                { path: DERIVED_PATHS[2]!, blob: write("new packed\n") },
            ],
            DERIVE_SYNC_COMMIT_SUBJECT
        );
        expect("sha" in built).toBe(true);
        const sha = (built as { sha: string }).sha;
        expect(git("log", "-1", "--format=%P", sha)).toBe(head);
        expect(git("log", "-1", "--format=%s", sha)).toBe(
            DERIVE_SYNC_COMMIT_SUBJECT
        );
        expect(
            git("diff-tree", "--no-commit-id", "--name-only", "-r", sha)
                .split("\n")
                .sort()
        ).toEqual([DERIVED_PATHS[0], DERIVED_PATHS[2]].sort());
        expect(git("show", `${sha}:${DERIVED_PATHS[0]}`)).toBe("new lockfile");
        expect(git("show", `${sha}:${DERIVED_PATHS[1]}`)).toBe("old hash");
        expect(git("show", `${sha}:keep.txt`)).toBe("keep");
        // The checkout: HEAD, index and tree exactly as before.
        expect(git("rev-parse", "HEAD")).toBe(head);
        expect(git("status", "--porcelain")).toBe("");
    });

    it("reports the failing git step instead of a sha", () => {
        const built = commitOnScratchIndex(
            run,
            "not-a-commit",
            [{ path: "x", blob: "0".repeat(40) }],
            "s"
        );
        expect("error" in built).toBe(true);
        expect((built as { error: string }).error).not.toBe("");
    });
});
