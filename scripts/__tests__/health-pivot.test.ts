/**
 * Health facts on the pivot (issue #5593, census of issue #5589 § 4): a run in
 * flight, a repair issue and a GREEN proved elsewhere are read from the
 * verdict store's transport — GitHub commit statuses — not from a local file.
 * The fake `gh` below is one in-memory repository both "machines" share.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { gateSkipReason } from "../lib/health-gate-skip";
import {
    pivotRepairIssues,
    pivotRepairOrigins,
    pivotRunInFlight,
    publishRunMarker,
    recordPivotRepairIssue,
} from "../lib/health-pivot";
import { type GhRunner, machineName } from "../lib/health-verdict-store";
import { baseHealthStatus, heldPrAction } from "../lib/pr-gate";

const TIP = "a".repeat(40);
const OLD = "b".repeat(40);
const MID = "c".repeat(40);

interface Status {
    state: string;
    context: string;
    description: string;
    created_at: string;
}

/** One shared repository: commits newest first, statuses per sha, and the
 *  issues closed on it (every other issue reads OPEN). */
function sharedRepo(
    commits: string[],
    clock: () => string,
    closed: ReadonlySet<number> = new Set()
) {
    const statuses = new Map<string, Status[]>();
    const run: GhRunner = (args) => {
        const joined = args.join(" ");
        const issue = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(
            args[1] ?? ""
        );
        if (args[0] === "api" && issue)
            return {
                status: 0,
                stdout: closed.has(Number(issue[1])) ? "closed\n" : "open\n",
                stderr: "",
            };
        const post = /statuses\/([0-9a-f]{40})$/.exec(
            args.find((a) => a.includes("/statuses/")) ?? ""
        );
        if (args.includes("POST") && post) {
            const field = (k: string) =>
                (args.find((a) => a.startsWith(`${k}=`)) ?? "").slice(
                    k.length + 1
                );
            const list = statuses.get(post[1]) ?? [];
            list.unshift({
                state: field("state"),
                context: field("context"),
                description: field("description"),
                created_at: clock(),
            });
            statuses.set(post[1], list);
            return { status: 0, stdout: "{}", stderr: "" };
        }
        const get = /commits\/([0-9a-f]{40})\/statuses/.exec(joined);
        if (get)
            return {
                status: 0,
                stdout: JSON.stringify(
                    (statuses.get(get[1]) ?? []).map((s) => ({
                        ...s,
                        target_url: null,
                    }))
                ),
                stderr: "",
            };
        const ctx = /context\(name:"([a-z-]+)"\)/.exec(joined)?.[1];
        const nodes = commits.map((oid) => {
            const s = (statuses.get(oid) ?? []).find((x) => x.context === ctx);
            return {
                oid,
                status: s
                    ? {
                          context: {
                              state: s.state,
                              description: s.description,
                              targetUrl: null,
                              createdAt: s.created_at,
                          },
                      }
                    : null,
            };
        });
        return {
            status: 0,
            stdout: JSON.stringify({
                data: {
                    repository: {
                        ref: { target: { history: { nodes } } },
                    },
                },
            }),
            stderr: "",
        };
    };
    const seed = (sha: string, s: Status) =>
        statuses.set(sha, [s, ...(statuses.get(sha) ?? [])]);
    return { run, seed };
}

let root: string;
beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "pivot-"));
    spawnSync("git", ["init", "-q"], { cwd: root });
    spawnSync(
        "git",
        ["remote", "add", "origin", "git@github.com:owner/name.git"],
        { cwd: root }
    );
});

let t = Date.parse("2026-10-14T10:00:00Z");
const clock = () => new Date((t += 1000)).toISOString();
const NOW = () => t + 60_000;
const STALE = 90 * 60_000;

/** Another machine: derived from this host's name so it never IS this host
 *  (a literal `omarchy` read as the Huawei's own marker there). */
const PEER = `${machineName()}-peer`;

/** A marker as the other machine's health run publishes it. */
const marker = (): Status => ({
    state: "pending",
    context: "health-run",
    description: `AMBER · running · ${PEER}`,
    created_at: clock(),
});

describe("run marker on the pivot", () => {
    it("a run another machine started is in flight; a settled verdict ends it", () => {
        const repo = sharedRepo([TIP, OLD], clock);
        repo.seed(TIP, marker());
        const read = () =>
            pivotRunInFlight(root, NOW(), STALE, {
                run: repo.run,
                stored: () => null,
            });
        expect(read()).toMatch(/health run on aaaaaaaa is already in flight/);
        expect(
            pivotRunInFlight(root, NOW(), STALE, {
                run: repo.run,
                stored: () => ({
                    sha: TIP,
                    status: "green",
                    at: new Date(t + 5000).toISOString(),
                }),
            })
        ).toBeNull();
    });

    it("this machine's own marker is left to its pid probe", () => {
        const repo = sharedRepo([TIP], clock);
        publishRunMarker(root, TIP, { run: repo.run });
        expect(
            pivotRunInFlight(root, NOW(), STALE, {
                run: repo.run,
                stored: () => null,
            })
        ).toBeNull();
    });

    it("a marker past the stale bound is a dead run", () => {
        const repo = sharedRepo([TIP], clock);
        repo.seed(TIP, marker());
        expect(
            pivotRunInFlight(root, NOW() + STALE, STALE, {
                run: repo.run,
                stored: () => null,
            })
        ).toBeNull();
    });
});

describe("repair issues on the pivot", () => {
    const red = () => ({
        state: "failure",
        context: "health",
        description: "RED · test · omarchy",
        created_at: clock(),
    });

    it("an issue recorded on one machine is read by the other", () => {
        const repo = sharedRepo([TIP, OLD], clock);
        repo.seed(TIP, red());
        const o = { run: repo.run } as const;
        expect(recordPivotRepairIssue(root, 7, o)).toMatch(/#7 recorded/);
        recordPivotRepairIssue(root, 3, o);
        expect(pivotRepairIssues(root, o)).toEqual([3, 7]);
    });

    it("tells the ladder's own repair issue from an interactive one (issue #6554)", () => {
        const repo = sharedRepo([TIP, OLD], clock);
        repo.seed(TIP, red());
        const o = { run: repo.run } as const;
        recordPivotRepairIssue(root, 6545, o);
        recordPivotRepairIssue(root, 6548, { ...o, ladder: true });
        // A later interactive record must not erase the ladder's mark.
        recordPivotRepairIssue(root, 6560, o);
        expect(pivotRepairIssues(root, o)).toEqual([6545, 6548, 6560]);
        expect(pivotRepairOrigins(root, o)).toEqual({
            ladder: [6548],
            foreign: [6545, 6560],
        });
    });

    it("no RED standing: nothing recorded, nothing read", () => {
        const repo = sharedRepo([TIP], clock);
        const o = { run: repo.run } as const;
        expect(recordPivotRepairIssue(root, 7, o)).toBeNull();
        expect(pivotRepairIssues(root, o)).toEqual([]);
    });

    // The 2026-10-27 sequence: the ladder declares #7135 against RED A, a
    // non-repair commit lands on top, health records RED B on it for the
    // same culprit — the ladder's revert PR must stay a declared repair.
    it("a repair declared on an earlier RED of the run is carried to the standing one (issue #7139)", () => {
        const repo = sharedRepo([TIP, OLD], clock);
        repo.seed(OLD, red());
        const o = { run: repo.run } as const;
        expect(
            recordPivotRepairIssue(root, 7135, { ...o, ladder: true })
        ).toMatch(/bbbbbbbb/);
        repo.seed(TIP, red());
        expect(pivotRepairIssues(root, o)).toEqual([7135]);
        expect(pivotRepairOrigins(root, o)).toEqual({
            ladder: [7135],
            foreign: [],
        });
        // Re-declared by hand on RED B, it stays the ladder's own.
        recordPivotRepairIssue(root, 7135, o);
        recordPivotRepairIssue(root, 7140, o);
        expect(pivotRepairOrigins(root, o)).toEqual({
            ladder: [7135],
            foreign: [7140],
        });
    });

    // The whole 2026-10-27 deadlock, end to end: the ladder's revert PR is
    // dequeued and `queue:held` when RED B lands; the re-gate must find it a
    // declared repair AND requeue it, with no hand step (issue #7140).
    it("a held ladder revert under a moved RED self-heals: base-health green, requeue decided (issue #7140)", () => {
        const repo = sharedRepo([TIP, OLD], clock);
        const o = { run: repo.run } as const;
        repo.seed(OLD, red());
        recordPivotRepairIssue(root, 7135, { ...o, ladder: true });
        repo.seed(TIP, red());
        const labels = ["ready-to-land", "queue:held"];
        const health = baseHealthStatus({
            lineage: { kind: "red", verdict: null },
            pr: {
                author: "fil-donadoni",
                body: "Revert the culprit.\n\nCloses #7135",
                headRef: "fix/issue-7135",
                headRepo: "owner/name",
                baseRepo: "owner/name",
            },
            repairIssues: pivotRepairIssues(root, o),
        });
        expect(health.state).toBe("success");
        expect(
            heldPrAction({
                labels,
                lineage: { kind: "red" },
                baseHealth: health.state,
                trustedAuthor: "success",
                lastRequeueAt: () => null,
                now: NOW(),
            })
        ).toBe("requeue");
    });

    it("stacked REDs: every earlier RED's repair is carried, whatever culprit each names", () => {
        const repo = sharedRepo([TIP, MID, OLD], clock);
        const o = { run: repo.run } as const;
        repo.seed(OLD, red());
        recordPivotRepairIssue(root, 1, o);
        repo.seed(MID, red());
        recordPivotRepairIssue(root, 2, { ...o, ladder: true });
        repo.seed(TIP, red());
        expect(pivotRepairOrigins(root, o)).toEqual({
            ladder: [2],
            foreign: [1],
        });
    });

    it("a GREEN or an AMBER between two REDs ends the run: nothing carried", () => {
        for (const between of [
            { state: "success", description: "GREEN · test · omarchy" },
            { state: "pending", description: "AMBER · repair · omarchy" },
        ]) {
            const repo = sharedRepo([TIP, MID, OLD], clock);
            const o = { run: repo.run } as const;
            repo.seed(OLD, red());
            recordPivotRepairIssue(root, 7, o);
            repo.seed(MID, {
                ...between,
                context: "health",
                created_at: clock(),
            });
            repo.seed(TIP, red());
            expect(pivotRepairIssues(root, o)).toEqual([]);
        }
    });

    it("a closed repair issue (its PR merged) is not carried; the standing RED's own still reads", () => {
        const repo = sharedRepo([TIP, OLD], clock, new Set([7, 9]));
        const o = { run: repo.run } as const;
        repo.seed(OLD, red());
        recordPivotRepairIssue(root, 7, o);
        recordPivotRepairIssue(root, 8, o);
        repo.seed(TIP, red());
        recordPivotRepairIssue(root, 9, o);
        expect(pivotRepairIssues(root, o)).toEqual([8, 9]);
    });

    it("an unreachable store reads as no issues, never a throw", () => {
        const o = {
            run: () => ({ status: 1, stdout: "", stderr: "down" }),
        } as const;
        expect(pivotRepairIssues(root, o)).toEqual([]);
    });
});

describe("gateSkipReason — a GREEN proved on the store", () => {
    const base = { last: null, tip: TIP, now: 0, retryTerminal: true };

    it("skips a tip the store holds GREEN, even with no local record", () => {
        expect(
            gateSkipReason({
                ...base,
                stored: { sha: TIP, status: "green", machine: "omarchy" },
            })
        ).toMatch(/already green on the verdict store \(omarchy\)/);
    });

    it("gates a tip the store holds RED, or a GREEN of another sha", () => {
        expect(
            gateSkipReason({ ...base, stored: { sha: TIP, status: "red" } })
        ).toBeNull();
        expect(
            gateSkipReason({ ...base, stored: { sha: OLD, status: "green" } })
        ).toBeNull();
    });
});
