import { describe, expect, it } from "vitest";
import { culpritLine } from "../lib/health-bisect";
import {
    decodeFixStatus,
    encodeFixDescription,
    FIX_CONTEXT,
    githubFixAttemptStore,
    type FixAttempt,
} from "../lib/health-fix-attempts";
import { githubVerdictStore, type GhRunner } from "../lib/health-verdict-store";
import {
    ATTEMPT_STALE_MS,
    LANDED_WAIT_MS,
    MAX_HOPS,
    MAX_REVERT_TRIES,
    mayRedispatch,
    REVERT_QUEUE_MAX_MS,
    revertRecordOf,
    TRANSIENT_NOTE,
    walkEpisode,
    escalationTitle,
    FOREIGN_REPAIR_MAX_MS,
    hostOfRunnerName,
    ownRepairPrs,
    ladderRung,
    MAX_FIX_ATTEMPTS,
    parseCulprit,
    revertBranch,
    revertPrBody,
    type EpisodeRed,
    type ForeignRepair,
    type LadderFacts,
} from "../lib/health-ladder";
import { FIX_CONTEXT as REPAIR_ISSUES_CONTEXT } from "../lib/health-pivot";
import { isAdoptableWorktree, issueOfBranch } from "../lib/issue-worktree";
import { repairItems } from "../lib/queue-plan";
import { closingIssueRefs } from "../lib/red-land-gate";
import { hasNoWalkOwedLine, revertedCommitOf } from "../lib/ui-scope";
import { prNumberOfUrl } from "../health-revert";

/**
 * The RED ladder's last rungs (issue #5646, ADR 0156 Amendment I): fix
 * forward at most twice, revert the culprit as the last resort, stop with
 * one escalation. Each rung is `ladderRung`'s, a pure function of the pivot's
 * facts.
 */
const RED = "a".repeat(40);
const OLD_RED = "b".repeat(40);
const NOW = Date.parse("2026-10-17T12:00:00Z");
const RECENT = new Date(NOW - 60_000).toISOString();
const CULPRIT = { sha: "c".repeat(12), pr: 5700 };

function facts(over: Partial<LadderFacts> = {}): LadderFacts {
    return {
        red: RED,
        secondRed: false,
        tip: RED,
        laddered: true,
        episode: [{ sha: RED, attempt: null, culprit: CULPRIT }],
        revertPr: null,
        foreignRepairs: [],
        escalated: null,
        now: NOW,
        ...over,
    };
}

function withAttempt(a: Partial<FixAttempt>, sha = RED): EpisodeRed[] {
    return [
        {
            sha,
            attempt: { sha, outcome: "stuck", at: RECENT, ...a },
            culprit: CULPRIT,
        },
    ];
}

describe("ladderRung — what is not the ladder's yet", () => {
    it("no RED standing: nothing to do", () => {
        expect(ladderRung(facts({ red: null })).kind).toBe("none");
    });

    it("an unreadable fact waits — an outage never escalates", () => {
        expect(ladderRung(facts({ error: "502" }))).toMatchObject({
            kind: "wait",
            why: expect.stringContaining("502"),
        });
    });

    it("an escalated RED holds quietly, whatever else stands (one email)", () => {
        expect(
            ladderRung(
                facts({
                    escalated: 42,
                    episode: withAttempt({ rung: "revert", outcome: "stuck" }),
                })
            )
        ).toMatchObject({ kind: "hold", why: expect.stringContaining("#42") });
    });

    it("waits while the base tip has no verdict (a repair just merged)", () => {
        expect(ladderRung(facts({ tip: "d".repeat(40) })).kind).toBe("wait");
    });

    it("waits for the flake check and the bisect before any fixer", () => {
        expect(ladderRung(facts({ laddered: false }))).toMatchObject({
            kind: "wait",
            why: expect.stringMatching(/flake check/),
        });
    });
});

describe("ladderRung — rung 4, fix forward, at most two attempts", () => {
    it("a fresh RED gets fixer attempt 1", () => {
        expect(ladderRung(facts())).toMatchObject({ kind: "fix", attempt: 1 });
    });

    it("attempt 1 stuck → attempt 2", () => {
        expect(
            ladderRung(facts({ episode: withAttempt({ attempt: 1 }) }))
        ).toMatchObject({ kind: "fix", attempt: 2 });
    });

    it("a record from before the ladder (no rung, no attempt) counts as attempt 1", () => {
        expect(ladderRung(facts({ episode: withAttempt({}) }))).toMatchObject({
            kind: "fix",
            attempt: 2,
        });
    });

    it("a running attempt waits — never a second fixer", () => {
        expect(
            ladderRung(
                facts({
                    episode: withAttempt({
                        outcome: "attempting",
                        attempt: 1,
                        machine: "huawei",
                    }),
                })
            )
        ).toMatchObject({
            kind: "wait",
            why: expect.stringContaining("huawei"),
        });
    });

    it("an attempt killed with its job (stale `attempting`) counts as used", () => {
        const at = new Date(NOW - ATTEMPT_STALE_MS - 1).toISOString();
        expect(
            ladderRung(
                facts({
                    episode: withAttempt({
                        outcome: "attempting",
                        attempt: 1,
                        at,
                    }),
                })
            )
        ).toMatchObject({ kind: "fix", attempt: 2 });
    });

    it("attempts count over the whole episode, not one sha", () => {
        const episode: EpisodeRed[] = [
            { sha: RED, attempt: null, culprit: CULPRIT },
            ...withAttempt({ attempt: MAX_FIX_ATTEMPTS }, OLD_RED),
        ];
        expect(ladderRung(facts({ episode })).kind).toBe("revert");
    });

    it("a repair landed against the standing RED waits for health", () => {
        expect(
            ladderRung(
                facts({
                    episode: withAttempt({ outcome: "landed", pr: 5800 }),
                })
            )
        ).toMatchObject({ kind: "wait", why: expect.stringContaining("5800") });
    });
});

describe("ladderRung — rung 5, revert as the last resort", () => {
    it("both attempts stuck → revert the culprit", () => {
        expect(
            ladderRung(
                facts({ episode: withAttempt({ attempt: MAX_FIX_ATTEMPTS }) })
            )
        ).toMatchObject({ kind: "revert", culprit: CULPRIT });
    });

    it("a second RED after a landed repair → revert, no new fixer", () => {
        const episode: EpisodeRed[] = [
            { sha: RED, attempt: null, culprit: null },
            ...withAttempt({ outcome: "landed", pr: 5800 }, OLD_RED),
        ];
        expect(ladderRung(facts({ episode }))).toMatchObject({
            kind: "revert",
            culprit: CULPRIT,
            why: expect.stringContaining("second RED"),
        });
    });

    it("a second RED after a proved repair (AMBER) → revert", () => {
        expect(ladderRung(facts({ secondRed: true })).kind).toBe("revert");
    });

    it("no culprit named → stop, not a guess", () => {
        expect(
            ladderRung(
                facts({
                    episode: [
                        {
                            sha: RED,
                            attempt: {
                                sha: RED,
                                outcome: "stuck",
                                attempt: 2,
                                at: RECENT,
                            },
                            culprit: null,
                        },
                    ],
                })
            )
        ).toMatchObject({
            kind: "stop",
            why: expect.stringContaining("cannot be isolated"),
        });
    });

    it("the revert PR in the queue waits", () => {
        expect(
            ladderRung(
                facts({
                    episode: withAttempt({
                        rung: "revert",
                        outcome: "attempting",
                        pr: 5900,
                    }),
                    revertPr: {
                        number: 5900,
                        state: "open",
                        landFailed: false,
                    },
                })
            ).kind
        ).toBe("wait");
    });
});

describe("ladderRung — rung 6, stop", () => {
    const reverting = withAttempt({
        rung: "revert",
        outcome: "attempting",
        pr: 5900,
    });

    it("a revert that does not apply stops", () => {
        expect(
            ladderRung(
                facts({
                    episode: withAttempt({
                        rung: "revert",
                        outcome: "stuck",
                        note: "conflict",
                    }),
                })
            )
        ).toMatchObject({
            kind: "stop",
            why: expect.stringContaining("conflict"),
        });
    });

    it("a revert PR the queue dequeued stops", () => {
        expect(
            ladderRung(
                facts({
                    episode: reverting,
                    revertPr: { number: 5900, state: "open", landFailed: true },
                })
            ).kind
        ).toBe("stop");
    });

    it("a revert PR closed unmerged stops", () => {
        expect(
            ladderRung(
                facts({
                    episode: reverting,
                    revertPr: {
                        number: 5900,
                        state: "closed",
                        landFailed: false,
                    },
                })
            ).kind
        ).toBe("stop");
    });

    it("a RED that outlives its merged revert stops — never a second revert", () => {
        const episode: EpisodeRed[] = [
            { sha: RED, attempt: null, culprit: CULPRIT },
            ...withAttempt(
                { rung: "revert", outcome: "attempting", pr: 5900 },
                OLD_RED
            ),
        ];
        expect(
            ladderRung(
                facts({
                    episode,
                    revertPr: {
                        number: 5900,
                        state: "merged",
                        landFailed: false,
                    },
                })
            )
        ).toMatchObject({
            kind: "stop",
            why: expect.stringContaining("after the revert"),
        });
    });

    it("a revert that never opened its PR stops once stale", () => {
        const at = new Date(NOW - ATTEMPT_STALE_MS - 1).toISOString();
        const episode = withAttempt({
            rung: "revert",
            outcome: "attempting",
            at,
        });
        expect(ladderRung(facts({ episode })).kind).toBe("stop");
        expect(
            ladderRung(
                facts({
                    episode: withAttempt({
                        rung: "revert",
                        outcome: "attempting",
                    }),
                })
            ).kind
        ).toBe("wait");
    });
});

describe("the ladder's facts and texts", () => {
    it("reads the culprit back from the bisect's own evidence line", () => {
        const line = culpritLine({
            result: {
                culprit: "c".repeat(40),
                probes: [{ sha: "c".repeat(40), outcome: "red" }],
            },
            good: "e".repeat(40),
            commits: 3,
            subject: "Something (#5700)",
        });
        expect(parseCulprit(`# RED\n\n${line}\n`)).toEqual(CULPRIT);
        const direct = culpritLine({
            result: { culprit: "c".repeat(40), probes: [] },
            good: null,
            commits: 1,
            subject: "a direct push",
        });
        expect(parseCulprit(direct)).toEqual({ sha: "c".repeat(12), pr: null });
    });

    it("an unnamed culprit reads as none", () => {
        const line = culpritLine({
            result: { culprit: null, probes: [], reason: "no GREEN" },
            good: null,
            commits: 0,
        });
        expect(parseCulprit(line)).toBeNull();
        expect(parseCulprit(null)).toBeNull();
    });

    it("a fixer's outcome never erases the repair issues the queue admits its PR by", () => {
        // A fake commit-status API: every POST is newest first; the
        // combined status keeps the latest per context, as GitHub's.
        const statuses: Array<{
            context: string;
            state: string;
            description: string;
            created_at: string | null;
            target_url: null;
        }> = [];
        const run: GhRunner = (args) => {
            const field = (k: string) =>
                args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1) ??
                "";
            if (args.includes("POST")) {
                statuses.unshift({
                    context: field("context"),
                    state: field("state"),
                    description: field("description"),
                    created_at: null,
                    target_url: null,
                });
                return { status: 0, stdout: "{}", stderr: "" };
            }
            const latest = statuses.filter(
                (s, i) =>
                    statuses.findIndex((t) => t.context === s.context) === i
            );
            return {
                status: 0,
                stdout: JSON.stringify(
                    args.some((a) => a.endsWith("/status")) ? latest : statuses
                ),
                stderr: "",
            };
        };
        const issues = githubVerdictStore({
            repo: "o/r",
            run,
            context: REPAIR_ISSUES_CONTEXT,
        });
        issues.write({
            sha: RED,
            status: "amber",
            step: "repair",
            issues: [6001],
        });
        githubFixAttemptStore({ repo: "o/r", run }).write({
            sha: RED,
            outcome: "stuck",
            rung: "fix",
            attempt: 1,
        });
        expect(statuses.map((s) => s.context)).toEqual([
            FIX_CONTEXT,
            REPAIR_ISSUES_CONTEXT,
        ]);
        expect(issues.read(RED)?.issues).toEqual([6001]);
        expect(
            githubFixAttemptStore({ repo: "o/r", run }).read(RED)
        ).toMatchObject({ outcome: "stuck", attempt: 1 });
    });

    it("a record's rung and attempt round-trip through the commit status", () => {
        const a: FixAttempt = {
            sha: RED,
            outcome: "stuck",
            rung: "revert",
            attempt: 1,
            machine: "macbook",
            pr: 5900,
            note: "conflict",
        };
        const description = encodeFixDescription(a);
        expect(description).toBe(
            "STUCK · macbook · revert 1 · PR #5900 · conflict"
        );
        expect(
            decodeFixStatus({
                sha: RED,
                state: "failure",
                description,
                createdAt: null,
            })
        ).toEqual(a);
    });

    it("the revert PR closes its repair issue — what `base-health` admits it by", () => {
        const body = revertPrBody({
            issue: 6001,
            red: RED,
            culprit: CULPRIT,
            revertedSha: "c".repeat(40),
            culpritIssues: [5690],
        });
        expect(closingIssueRefs(body)).toEqual([6001]);
        expect(body).toMatch(/^## Preset scenario$/m);
        // The verified revert line, never the bare no-walk claim `land`
        // refuses for an owed diff (issue #6071).
        expect(revertedCommitOf(body)).toBe("c".repeat(40));
        expect(hasNoWalkOwedLine(body)).toBe(false);
    });

    it("the revert branch names its repair issue, so a land-failed revert is a repair pick (issue #6071)", () => {
        const branch = revertBranch(6001);
        expect(issueOfBranch(branch)).toBe(6001);
        expect(isAdoptableWorktree(6001, branch)).toBe(true);
        expect(
            repairItems(
                [{ number: 6002, headRefName: branch }],
                () => ({ labels: ["bug"], body: "" }),
                {
                    batchCap: 1,
                    staleClaimHours: 24,
                    defaultImplModel: "sonnet",
                    now: "2026-10-21T00:00:00Z",
                }
            ).map((r) => [r.number, r.pr])
        ).toEqual([[6001, 6002]]);
    });

    it("one escalation title per RED sha", () => {
        expect(escalationTitle(RED)).toBe("RED ladder stopped @ aaaaaaaa");
    });

    it("finds the host in a runner's name", () => {
        expect(hostOfRunnerName("macbook-lane-1")).toBe("macbook");
        expect(hostOfRunnerName("my-box-pass-12")).toBe("my-box");
        expect(hostOfRunnerName("macbook")).toBeNull();
        expect(hostOfRunnerName(undefined)).toBeNull();
    });

    it("reads the PR number off `gh pr create`'s URL", () => {
        expect(prNumberOfUrl("https://github.com/o/r/pull/5901\n")).toBe(5901);
        expect(prNumberOfUrl("nope")).toBeNull();
    });
});

describe("review fixes — the bounds no rung can escape", () => {
    it("a stop marker holds, so a stop whose issue failed emails once", () => {
        expect(
            ladderRung(
                facts({
                    episode: withAttempt({ rung: "stop", outcome: "stuck" }),
                })
            ).kind
        ).toBe("hold");
    });

    it("a revert try that failed transiently is retried, then stops", () => {
        const note = `${TRANSIENT_NOTE}gh 502`;
        expect(
            ladderRung(
                facts({
                    episode: withAttempt({ rung: "revert", attempt: 1, note }),
                })
            )
        ).toMatchObject({ kind: "revert", attempt: 2, culprit: CULPRIT });
        expect(
            ladderRung(
                facts({
                    episode: withAttempt({
                        rung: "revert",
                        attempt: MAX_REVERT_TRIES,
                        note,
                    }),
                })
            ).kind
        ).toBe("stop");
    });

    it("a `landed` that never moved the tip counts as used after the bound", () => {
        const old = new Date(NOW - LANDED_WAIT_MS - 1).toISOString();
        expect(
            ladderRung(
                facts({
                    episode: withAttempt({
                        outcome: "landed",
                        attempt: 1,
                        at: old,
                    }),
                })
            )
        ).toMatchObject({ kind: "fix", attempt: 2 });
    });

    it("a revert PR held in the queue past the bound stops", () => {
        const old = new Date(NOW - REVERT_QUEUE_MAX_MS - 1).toISOString();
        expect(
            ladderRung(
                facts({
                    episode: withAttempt({
                        rung: "revert",
                        outcome: "attempting",
                        pr: 5900,
                        at: old,
                    }),
                    revertPr: {
                        number: 5900,
                        state: "open",
                        landFailed: false,
                    },
                })
            ).kind
        ).toBe("stop");
    });

    it("a Next-rung chain is bounded", () => {
        expect(mayRedispatch(0)).toBe(true);
        expect(mayRedispatch(MAX_HOPS - 2)).toBe(true);
        expect(mayRedispatch(MAX_HOPS - 1)).toBe(false);
        expect(mayRedispatch(Number.NaN)).toBe(false);
    });
});

describe("walkEpisode — the REDs since the last GREEN", () => {
    const line = culpritLine({
        result: { culprit: "c".repeat(40), probes: [] },
        good: null,
        commits: 1,
        subject: "x (#5700)",
    });
    const status: Record<string, string> = {
        s5: "red",
        s4: "amber",
        s3: "infra",
        s2: "red",
        s1: "green",
        s0: "red",
    };
    const read = {
        status: (sha: string) => status[sha] ?? null,
        attempt: (sha: string): FixAttempt | null =>
            sha === "s2"
                ? { sha, outcome: "attempting", rung: "revert", pr: 5900 }
                : null,
        evidence: (sha: string) =>
            sha === "s5" ? `# RED\n${line}` : `ev ${sha}`,
    };

    it("newest first, past AMBER, INFRA and unverdicted commits, stopping at GREEN", () => {
        const { episode, standingEvidence } = walkEpisode(
            ["s5", "s4", "x", "s3", "s2", "s1", "s0"],
            read
        );
        expect(episode.map((r) => r.sha)).toEqual(["s5", "s2"]);
        expect(standingEvidence).toBe(`# RED\n${line}`);
        expect(episode[0].culprit).toEqual(CULPRIT);
        expect(revertRecordOf(episode)).toMatchObject({ pr: 5900 });
    });

    it("the standing RED's evidence only — never an older RED's", () => {
        const { standingEvidence } = walkEpisode(["s2", "s1"], read);
        expect(standingEvidence).toBe("ev s2");
        expect(walkEpisode(["x", "s2"], read).standingEvidence).toBeNull();
    });
});

describe("ladderRung — a repair declared outside the ladder (issue #6554)", () => {
    const repair = (
        over: Partial<NonNullable<ForeignRepair["pr"]>> | null
    ): ForeignRepair[] => [
        {
            issue: 6545,
            pr:
                over === null
                    ? null
                    : {
                          number: 6546,
                          state: "open",
                          landFailed: false,
                          createdAt: NOW - 60_000,
                          ...over,
                      },
        },
    ];

    it("an open PR waits, naming it — no fixer is spawned", () => {
        expect(ladderRung(facts({ foreignRepairs: repair({}) }))).toMatchObject(
            {
                kind: "wait",
                why: expect.stringContaining("PR #6546"),
            }
        );
    });

    it("waits instead of the revert too (both fixer attempts stuck)", () => {
        expect(
            ladderRung(
                facts({
                    foreignRepairs: repair({}),
                    episode: [
                        {
                            sha: RED,
                            attempt: {
                                sha: RED,
                                outcome: "stuck",
                                attempt: 2,
                                at: RECENT,
                            },
                            culprit: CULPRIT,
                        },
                    ],
                })
            ).kind
        ).toBe("wait");
    });

    it("merged with the tip un-gated waits as today", () => {
        expect(
            ladderRung(
                facts({
                    tip: "d".repeat(40),
                    foreignRepairs: repair({ state: "merged" }),
                })
            ).kind
        ).toBe("wait");
    });

    it.each([
        ["closed unmerged", { state: "closed" as const }],
        ["land-failed", { landFailed: true }],
        ["past the bound", { createdAt: NOW - FOREIGN_REPAIR_MAX_MS - 1 }],
    ])("a PR %s releases the ladder to its own rung", (_n, over) => {
        expect(
            ladderRung(facts({ foreignRepairs: repair(over) }))
        ).toMatchObject({ kind: "fix", attempt: 1 });
    });

    it("a declared repair with no PR yet does not hold the ladder", () => {
        expect(ladderRung(facts({ foreignRepairs: repair(null) })).kind).toBe(
            "fix"
        );
    });
});

describe("ownRepairPrs — a stuck attempt withdraws only its own", () => {
    const prs = [
        { number: 6546, closes: [6545] },
        { number: 6550, closes: [6548] },
        { number: 6551, closes: [] },
    ];

    it("closes the PR closing the attempt's issue, never another session's", () => {
        expect(ownRepairPrs(prs, [6548])).toEqual([6550]);
    });

    it("an interactive-only pivot withdraws nothing", () => {
        expect(ownRepairPrs(prs, [])).toEqual([]);
    });
});
