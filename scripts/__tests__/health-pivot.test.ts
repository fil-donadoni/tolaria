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
    pivotRunInFlight,
    publishRunMarker,
    recordPivotRepairIssue,
} from "../lib/health-pivot";
import { type GhRunner, machineName } from "../lib/health-verdict-store";

const TIP = "a".repeat(40);
const OLD = "b".repeat(40);

interface Status {
    state: string;
    context: string;
    description: string;
    created_at: string;
}

/** One shared repository: commits newest first, statuses per sha. */
function sharedRepo(commits: string[], clock: () => string) {
    const statuses = new Map<string, Status[]>();
    const run: GhRunner = (args) => {
        const joined = args.join(" ");
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

    it("no RED standing: nothing recorded, nothing read", () => {
        const repo = sharedRepo([TIP], clock);
        const o = { run: repo.run } as const;
        expect(recordPivotRepairIssue(root, 7, o)).toBeNull();
        expect(pivotRepairIssues(root, o)).toEqual([]);
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
