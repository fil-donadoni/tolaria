/**
 * Base-drift preflight (issue #6647, `lib/base-drift.ts`): the four answers,
 * the verdict, `land:ready`'s step 0 against fakes, and the measurement
 * against a real repository.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
    buildReceipt,
    buildReport,
    coupledHits,
    COUPLED_PATHS,
    DERIVED_OWNER_PATHS,
    driftVerdict,
    measureDrift,
    overlappingPrs,
    preflightLandReady,
    queueState,
    regenerationCommands,
    restLogin,
    renderReport,
    type DriftMeasure,
    type OpenPr,
} from "../lib/base-drift";
import { CARD_INDEX_PATH, LOCKFILE_PATH } from "../lib/derive-sync";
import { scrubGitRepoEnv } from "../lib/git-repo-env";

const measure = (over: Partial<DriftMeasure> = {}): DriftMeasure => ({
    branch: "feat/issue-1",
    branchHead: "1111111111111111111111111111111111111111",
    base: "origin/main",
    baseSha: "2222222222222222222222222222222222222222",
    mergeBase: "3333333333333333333333333333333333333333",
    behind: 0,
    baseChanged: [],
    branchChanged: ["scripts/a.ts"],
    ...over,
});

const pr = (over: Partial<OpenPr> = {}): OpenPr => ({
    number: 10,
    title: "t",
    labels: [],
    files: [{ path: "scripts/a.ts" }],
    headRefName: "feat/issue-10",
    author: { login: "someone" },
    ...over,
});

describe("base-drift — the coupled artefacts come from their owners", () => {
    it("every derived path the base writes is a coupled artefact", () => {
        for (const p of DERIVED_OWNER_PATHS) expect(COUPLED_PATHS).toContain(p);
        expect(COUPLED_PATHS).toContain(LOCKFILE_PATH);
        expect(COUPLED_PATHS).toContain(CARD_INDEX_PATH);
    });

    it("a base rewrite of the lockfile couples a branch that changed a card, not one that changed a script", () => {
        const base = [LOCKFILE_PATH];
        expect(coupledHits(base, ["convex/cards/sets/ice.ts"])).toEqual([
            {
                path: LOCKFILE_PATH,
                regenerate: "bun run derive:regenerate",
                via: "inputs",
            },
        ]);
        expect(coupledHits(base, ["scripts/a.ts"])).toEqual([]);
        expect(coupledHits(base, [LOCKFILE_PATH])[0]?.via).toBe("path");
        expect(
            regenerationCommands(
                coupledHits(base, [LOCKFILE_PATH, CARD_INDEX_PATH])
            )
        ).toEqual(["bun run derive:regenerate"]);
    });
});

describe("base-drift — answer 4: queued PRs sharing files", () => {
    it("reads Mergify's label, a merge-queue draft and the hand-off label; nothing else is a queue state", () => {
        expect(queueState(pr({ labels: [{ name: "queued" }] }))).toBe("queued");
        expect(
            queueState(
                pr({
                    author: { login: "mergify[bot]" },
                    headRefName: "mergify/merge-queue/abc",
                })
            )
        ).toBe("draft");
        expect(queueState(pr({ labels: [{ name: "ready-to-land" }] }))).toBe(
            "ready-to-land"
        );
        expect(queueState(pr())).toBeNull();
    });

    it("reads `gh`'s `app/mergify` login as the REST `mergify[bot]`, and never a fork's lookalike", () => {
        expect(restLogin("app/mergify")).toBe("mergify[bot]");
        expect(restLogin("someone")).toBe("someone");
        const draft = pr({
            author: { login: "app/mergify" },
            headRefName: "mergify/merge-queue/abc",
        });
        expect(queueState(draft)).toBe("draft");
        expect(queueState({ ...draft, isCrossRepository: true })).toBeNull();
    });

    it("lists only queue-state PRs whose files meet the branch's, never the branch's own PR", () => {
        const open = [
            pr({ number: 10, labels: [{ name: "queued" }] }),
            pr({
                number: 11,
                labels: [{ name: "ready-to-land" }],
                files: [{ path: "other.ts" }],
            }),
            pr({ number: 12 }),
            pr({ number: 13, labels: [{ name: "ready-to-land" }] }),
        ];
        expect(overlappingPrs(["scripts/a.ts"], open, 13)).toEqual([
            {
                number: 10,
                title: "t",
                state: "queued",
                files: ["scripts/a.ts"],
            },
        ]);
    });
});

describe("base-drift — the verdict", () => {
    it("CURRENT when the base has not moved, whatever the queue holds", () => {
        const r = buildReport(
            measure(),
            [pr({ labels: [{ name: "queued" }] })],
            null
        );
        expect(driftVerdict(r)).toEqual({ kind: "current" });
        expect(r.prs.map((p) => p.number)).toEqual([10]);
        expect(renderReport(r, driftVerdict(r))).toMatch(/NOTE: 1 queued PR/);
    });

    it("REBASE when behind with nothing shared", () => {
        const r = buildReport(
            measure({
                behind: 3,
                baseChanged: ["convex/gre/x.ts", LOCKFILE_PATH],
            }),
            [],
            null
        );
        expect(driftVerdict(r)).toEqual({ kind: "rebase" });
        expect(renderReport(r, driftVerdict(r))).toMatch(/verdict: REBASE/);
    });

    it("OVERLAP when behind and a file changed on both sides, naming it", () => {
        const r = buildReport(
            measure({ behind: 1, baseChanged: ["scripts/a.ts", "b.ts"] }),
            [],
            null
        );
        const v = driftVerdict(r);
        expect(v.kind).toBe("refuse");
        expect(r.overlap).toEqual(["scripts/a.ts"]);
        expect(renderReport(r, v)).toMatch(/both sides: scripts\/a\.ts/);
    });

    it("OVERLAP when behind and the base rewrote a coupled artefact this branch's inputs feed, naming the regenerator", () => {
        const r = buildReport(
            measure({
                behind: 1,
                baseChanged: [LOCKFILE_PATH],
                branchChanged: ["convex/cards/sets/ice.ts"],
            }),
            [],
            null
        );
        const v = driftVerdict(r);
        expect(v.kind).toBe("refuse");
        expect(renderReport(r, v)).toMatch(/derive:regenerate/);
        const receipt = buildReceipt(r, v, new Date(0));
        expect(receipt).toMatchObject({
            behind: 1,
            coupled: [LOCKFILE_PATH],
            verdict: "refuse",
            baseSha: r.baseSha,
        });
    });

    it("prints the four numbered answers", () => {
        const text = renderReport(buildReport(measure(), [], null), {
            kind: "current",
        });
        for (const n of [
            "1. behind",
            "2. overlap",
            "3. coupled",
            "4. open PRs",
        ])
            expect(text).toContain(n);
    });
});

describe("base-drift — land:ready's step 0 (issue #6647)", () => {
    const deps = (m: DriftMeasure, rebaseOk = true, pushFails = false) => {
        const calls: string[] = [];
        return {
            calls,
            deps: {
                measure: () => m,
                openPrs: () => [],
                rebase: () =>
                    (calls.push("rebase"), rebaseOk)
                        ? ({ ok: true } as const)
                        : ({
                              ok: false,
                              why: "CONFLICT (content): a.txt",
                          } as const),
                push: (expected: string) => {
                    calls.push(`push:${expected}`);
                    if (pushFails) throw new Error("! [rejected] stale info");
                },
                head: () => "4444444444444444444444444444444444444444",
                log: () => undefined,
            },
        };
    };

    it("current: the pushed head stands, nothing is rebased or pushed", () => {
        const d = deps(measure());
        expect(preflightLandReady(7, d.deps).head).toBe(measure().branchHead);
        expect(d.calls).toEqual([]);
    });

    it("behind with no overlap: rebases, pushes over the old head, returns the new one", () => {
        const m = measure({ behind: 4, baseChanged: ["x.ts"] });
        const d = deps(m);
        const out = preflightLandReady(7, d.deps);
        expect(d.calls).toEqual(["rebase", `push:${m.branchHead}`]);
        expect(out.head).toBe("4444444444444444444444444444444444444444");
        expect(out.verdict).toEqual({ kind: "rebase" });
    });

    it("behind with an overlap: refuses, listing the files and the regenerators, pushing nothing", () => {
        const m = measure({
            behind: 2,
            baseChanged: ["scripts/a.ts", LOCKFILE_PATH],
            branchChanged: ["scripts/a.ts", "convex/cards/sets/ice.ts"],
        });
        const d = deps(m);
        expect(() => preflightLandReady(7, d.deps)).toThrow(
            /2 commit\(s\) behind[\s\S]*scripts\/a\.ts[\s\S]*derive:regenerate/
        );
        expect(d.calls).toEqual([]);
    });

    it("a conflicting automatic rebase is aborted and refused — never pushed", () => {
        const d = deps(measure({ behind: 1, baseChanged: ["x.ts"] }), false);
        expect(() => preflightLandReady(7, d.deps)).toThrow(/CONFLICT.*a\.txt/);
        expect(d.calls).toEqual(["rebase"]);
    });

    it("a rejected push after the rebase names the local-only head and the push to make — never a bare 'HEAD is not the pushed head'", () => {
        const m = measure({ behind: 1, baseChanged: ["x.ts"] });
        const d = deps(m, true, true);
        expect(() => preflightLandReady(7, d.deps)).toThrow(
            /rebased onto origin\/main as 4444444444[\s\S]*stale info[\s\S]*git push --force-with-lease origin HEAD:feat\/issue-1/
        );
    });
});

describe("base-drift — measureDrift against a real repository", () => {
    let repo: string;
    const git = (...args: string[]): string => {
        const env = { ...process.env };
        scrubGitRepoEnv(env);
        const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", env });
        if (r.status !== 0)
            throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
        return r.stdout;
    };
    const write = (rel: string, text: string): void => {
        mkdirSync(dirname(join(repo, rel)), { recursive: true });
        writeFileSync(join(repo, rel), text);
    };

    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), "base-drift-"));
        git("init", "-q", "-b", "main");
        git("config", "user.email", "t@example.com");
        git("config", "user.name", "t");
        git("config", "commit.gpgsign", "false");
        write("a.txt", "a\n");
        write(LOCKFILE_PATH, "lock\n");
        git("add", ".");
        git("commit", "-q", "-m", "seed");
        // A fake origin/main ref the base moves on.
        git("update-ref", "refs/remotes/origin/main", "HEAD");
        git("switch", "-q", "-c", "feat/issue-1");
        write("a.txt", "a branch\n");
        write("convex/cards/sets/ice.ts", "card\n");
        git("add", ".");
        git("commit", "-q", "-m", "branch work");
    });
    afterEach(() =>
        rmSync(repo, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        })
    );

    it("unmoved base: behind 0, nothing changed on the base", () => {
        const m = measureDrift({ run: (a) => git(...a) }, "origin/main");
        expect(m.behind).toBe(0);
        expect(m.baseChanged).toEqual([]);
        expect(m.branchChanged.sort()).toEqual([
            "a.txt",
            "convex/cards/sets/ice.ts",
        ]);
    });

    it("a base-side rename of a file this branch edits is an overlap under its old name (--no-renames)", () => {
        git("switch", "-q", "main");
        git("mv", "a.txt", "renamed.txt");
        git("commit", "-q", "-m", "base rename");
        git("update-ref", "refs/remotes/origin/main", "HEAD");
        git("switch", "-q", "feat/issue-1");
        const r = buildReport(
            measureDrift({ run: (a) => git(...a) }, "origin/main"),
            [],
            null
        );
        expect(r.behind).toBe(1);
        expect(r.overlap).toEqual(["a.txt"]);
    });

    it("base moved twice: counts both commits, names the shared file and the coupled lockfile", () => {
        git("switch", "-q", "main");
        write("a.txt", "a base\n");
        git("commit", "-q", "-am", "base 1");
        write(LOCKFILE_PATH, "lock2\n");
        git("commit", "-q", "-am", "base 2");
        git("update-ref", "refs/remotes/origin/main", "HEAD");
        git("switch", "-q", "feat/issue-1");
        const m = measureDrift({ run: (a) => git(...a) }, "origin/main");
        expect(m.behind).toBe(2);
        expect(m.branch).toBe("feat/issue-1");
        const r = buildReport(m, [], null);
        expect(r.overlap).toEqual(["a.txt"]);
        expect(r.coupled.map((c) => c.path)).toEqual([LOCKFILE_PATH]);
        expect(driftVerdict(r).kind).toBe("refuse");
    });
});
