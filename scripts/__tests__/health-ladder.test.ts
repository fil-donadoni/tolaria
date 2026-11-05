import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    attributeMaintenance,
    bisectCulprits,
    culpritLine,
    culpritLines,
    type CulpritReport,
} from "../lib/health-bisect";
import { BASE_MAINTENANCE_SUBJECTS } from "../lib/derive-sync";
import { buildEvidence, withEvidenceLine } from "../lib/health-evidence";
import {
    decodeFixStatus,
    encodeFixDescription,
    FIX_CONTEXT,
    githubFixAttemptStore,
    prsOf,
    type FixAttempt,
} from "../lib/health-fix-attempts";
import {
    decodeStatus,
    encodeDescription,
    githubVerdictStore,
    lineageBlocks,
    lineageOf,
    type GhRunner,
    type Verdict,
} from "../lib/health-verdict-store";
import { LANDINGS_PER_BATCH } from "../lib/health-batch-due";
import {
    ATTEMPT_STALE_MS,
    HANDED_OFF_WAIT_MS,
    MAX_HOPS,
    MAX_REVERT_TRIES,
    mayRedispatch,
    REVERT_QUEUE_MAX_MS,
    revertRecordOf,
    revertRecordsOf,
    TRANSIENT_NOTE,
    walkEpisode,
    escalationBody,
    escalationTitle,
    CAP_NOTE,
    MAX_REVERT_SET,
    FOREIGN_REPAIR_MAX_MS,
    hostOfRunnerName,
    ownRepairPrs,
    ladderRung,
    containedGrant,
    inheritedClass,
    noCulpritIssueBody,
    noCulpritIssueTitle,
    PIPELINE_TOOLING_TESTS,
    settleContainedGrant,
    type ContainedGrantEffects,
    escalationOf,
    episodeFirstRed,
    revertDoesNotApply,
    verdictRunFails,
    withoutClass,
    spentHandOffs,
    MAX_FIX_ATTEMPTS,
    parseCulprits,
    reopenComment,
    revertAcknowledgements,
    revertBranch,
    revertPrBody,
    type EpisodeRed,
    type ForeignRepair,
    type LadderFacts,
} from "../lib/health-ladder";
import { FIX_CONTEXT as REPAIR_ISSUES_CONTEXT } from "../lib/health-pivot";
import { revertGroups, type RevertPlan } from "../lib/health-revert-set";
import { isAdoptableWorktree, issueOfBranch } from "../lib/issue-worktree";
import type { CardRow } from "../lib/oracle-lockfile";
import {
    ledgerTextWith,
    parseRegressionLedger,
    readyRegressions,
    unacknowledgedRegressions,
} from "../lib/oracle-state-regressions";
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
const TIP = "d".repeat(40);

function facts(over: Partial<LadderFacts> = {}): LadderFacts {
    return {
        red: RED,
        secondRed: false,
        tip: RED,
        laddered: true,
        sinceRed: null,
        repairPrs: [],
        episode: [{ sha: RED, attempt: null, culprits: [CULPRIT] }],
        revertPrs: [],
        fixPrs: [],
        foreignRepairs: [],
        escalated: null,
        now: NOW,
        ...over,
    };
}

/** The facts of a RED the bisect named no culprit for: the fixer's. */
function noCulprit(over: Partial<LadderFacts> = {}): LadderFacts {
    const f = facts(over);
    return {
        ...f,
        episode: f.episode.map((r) => ({ ...r, culprits: [] })),
    };
}

function withAttempt(a: Partial<FixAttempt>, sha = RED): EpisodeRed[] {
    return [
        {
            sha,
            attempt: { sha, outcome: "stuck", at: RECENT, ...a },
            culprits: [CULPRIT],
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
        expect(
            ladderRung(
                facts({
                    tip: TIP,
                    sinceRed: [{ sha: TIP, pr: 5800, message: "fix (#5800)" }],
                    repairPrs: [5800],
                })
            )
        ).toMatchObject({
            kind: "wait",
            why: expect.stringContaining("PR #5800 is a declared repair"),
        });
    });

    it("waits while the base tip does not descend from the RED", () => {
        expect(ladderRung(facts({ tip: TIP, sinceRed: null })).kind).toBe(
            "wait"
        );
    });

    it("waits for the flake check and the bisect before any fixer", () => {
        expect(ladderRung(facts({ laddered: false }))).toMatchObject({
            kind: "wait",
            why: expect.stringMatching(/flake check/),
        });
    });
});

describe("ladderRung — a bisected RED is the lineage verdict of later tips (issue #6766)", () => {
    // 2026-10-24: RED @ f315813d, culprit PR #6562 bisected; the tip moved by
    // PR #6657 and a derive commit only. The ladder waited ~50 min for a
    // health run on the new tip, and the revert then no longer applied.
    const replay = (over: Partial<LadderFacts> = {}) =>
        facts({
            tip: TIP,
            episode: [
                {
                    sha: RED,
                    attempt: null,
                    culprits: [{ sha: "e7e3aa389e99", pr: 6562 }],
                },
            ],
            sinceRed: [
                {
                    sha: TIP,
                    pr: null,
                    message: "bot-replay — replay the Bot-play sweep",
                },
                {
                    sha: "f".repeat(40),
                    pr: 6657,
                    message:
                        "Ice/Legends dropped clauses (issue #1835) (#6657)",
                },
            ],
            ...over,
        });

    it("a tip one PR past a bisected RED gets the revert rung at once, not a wait", () => {
        expect(ladderRung(replay())).toMatchObject({
            kind: "revert",
            culprits: [{ sha: "e7e3aa389e99", pr: 6562 }],
            attempt: 1,
        });
    });

    it("an unbisected RED still waits for the tip's own verdict", () => {
        expect(ladderRung(replay({ laddered: false })).kind).toBe("wait");
        expect(
            ladderRung(
                replay({
                    episode: [{ sha: RED, attempt: null, culprits: [] }],
                })
            )
        ).toMatchObject({ kind: "wait", why: /not bisected/ });
    });

    it("a commit after the RED naming the culprit (a revert of it) waits", () => {
        const sinceRed = [
            {
                sha: TIP,
                pr: 7014,
                message: 'Revert "fix(ui): stack panel (#6562)" (#7014)',
            },
        ];
        expect(ladderRung(replay({ sinceRed }))).toMatchObject({
            kind: "wait",
            why: expect.stringContaining("reverts the culprit"),
        });
        const gitRevert = [
            {
                sha: TIP,
                pr: null,
                message:
                    'Revert "x"\n\nThis reverts commit e7e3aa389e99ffffffffffffffffffffffffffff.',
            },
        ];
        expect(ladderRung(replay({ sinceRed: gitRevert })).kind).toBe("wait");
    });

    it("a later commit merely mentioning the culprit's PR does not hold the revert", () => {
        const sinceRed = [
            {
                sha: TIP,
                pr: 6657,
                message: "follow-up to #6562 (#6657)\n\nBuilds on #6562.",
            },
        ];
        expect(ladderRung(replay({ sinceRed })).kind).toBe("revert");
    });

    it("a revert PR the ladder recorded, merged, waits for health on its tip", () => {
        const episode: EpisodeRed[] = [
            {
                sha: RED,
                attempt: {
                    sha: RED,
                    rung: "revert",
                    outcome: "attempting",
                    pr: 7014,
                    at: RECENT,
                },
                culprits: [{ sha: "e7e3aa389e99", pr: 6562 }],
            },
        ];
        expect(
            ladderRung(
                replay({
                    episode,
                    repairPrs: [7014],
                    sinceRed: [
                        { sha: TIP, pr: 7014, message: "Revert (#7014)" },
                    ],
                    revertPrs: [
                        {
                            number: 7014,
                            state: "merged",
                            landFailed: false,
                        },
                    ],
                })
            ).kind
        ).toBe("wait");
    });
});

describe("ladderRung — rung 4, a named culprit is reverted first (ADR 0158 § 3)", () => {
    it("a fresh RED with a culprit → the revert, never the fixer", () => {
        expect(ladderRung(facts())).toMatchObject({
            kind: "revert",
            culprits: [CULPRIT],
            attempt: 1,
        });
    });

    it("a culprit named on an earlier RED of the episode is reverted too", () => {
        const episode: EpisodeRed[] = [
            { sha: RED, attempt: null, culprits: [] },
            { sha: OLD_RED, attempt: null, culprits: [CULPRIT] },
        ];
        expect(ladderRung(facts({ episode }))).toMatchObject({
            kind: "revert",
            culprits: [CULPRIT],
        });
    });
});

describe("ladderRung — a bisect that named several culprits reverts them all (issue #7446)", () => {
    // 2026-10-28: RED @ 6491254e, the bisect named PR #7401 (5 of 6 failing
    // tests) and `4706e0d0c3a0` (1 of 6). The ladder reverted one culprit;
    // PR #7401, most of the RED, waited for the owner's hand revert.
    const FIRST = { sha: "ef361cafea86", pr: 7401 };
    const SECOND = { sha: "4706e0d0c3a0", pr: 7398 };
    const lineOf = (sha: string, pr: number, n: number) =>
        `${culpritLine({
            result: { culprit: sha.padEnd(40, "0"), probes: [] },
            good: "e".repeat(40),
            commits: 9,
            subject: `x (#${pr})`,
        })} · explains ${n} of 6 failing test(s): \`t\``;
    const evidence = [
        "# RED",
        lineOf(FIRST.sha, 7401, 5),
        lineOf(SECOND.sha, 7398, 1),
    ].join("\n");
    const twoCulprits = (over: Partial<LadderFacts> = {}) =>
        facts({
            episode: walkEpisode([RED], {
                status: () => "red",
                attempt: () => null,
                evidence: () => evidence,
            }).episode,
            ...over,
        });

    it("the revert rung carries every culprit the evidence names, oldest first", () => {
        expect(ladderRung(twoCulprits())).toMatchObject({
            kind: "revert",
            culprits: [FIRST, SECOND],
            attempt: 1,
        });
    });

    it("a transient retry still carries every culprit", () => {
        const f = twoCulprits();
        f.episode[0].attempt = {
            sha: RED,
            rung: "revert",
            outcome: "stuck",
            attempt: 1,
            at: RECENT,
            note: `${TRANSIENT_NOTE}push refused`,
        };
        expect(ladderRung(f)).toMatchObject({
            kind: "revert",
            culprits: [FIRST, SECOND],
            attempt: 2,
        });
    });

    it("one culprit reverted by hand since the RED: the RED stands, the other is reverted", () => {
        const handRevert = {
            sha: TIP,
            pr: 7411,
            message: `Revert "x (#7401)" (#7411)\n\nThis reverts commit ${FIRST.sha}.`,
        };
        expect(
            ladderRung(twoCulprits({ tip: TIP, sinceRed: [handRevert] }))
        ).toMatchObject({ kind: "revert", culprits: [SECOND] });
        // Both reverted: health gates the tip — no revert of a reverted commit.
        const second = {
            sha: "f".repeat(40),
            pr: 7412,
            message: `Revert "x (#7398)" (#7412)`,
        };
        expect(
            ladderRung(
                twoCulprits({ tip: TIP, sinceRed: [second, handRevert] })
            )
        ).toMatchObject({ kind: "wait", why: /revert the culprits/ });
    });

    it("the revert PR and its reopen comment name every culprit", () => {
        const body = revertPrBody({
            issue: 6001,
            red: RED,
            culprits: [
                { ...FIRST, full: FIRST.sha.padEnd(40, "0") },
                { ...SECOND, full: SECOND.sha.padEnd(40, "0") },
            ],
            culpritIssues: [7390, 7395],
        });
        expect(body).toContain("Reverts PR #7401 and PR #7398");
        expect(closingIssueRefs(body)).toEqual([6001]);
        const comment = reopenComment({
            red: RED,
            culprits: [FIRST, SECOND],
            revertPr: 7500,
            evidence: null,
        });
        expect(comment).toContain("PR #7401 and PR #7398 turned the base RED");
        expect(comment).toContain("PR #7500 reverts them");
    });
});

describe("ladderRung — rung 5, fix forward only where a revert cannot, at most two attempts", () => {
    it("a RED with no culprit gets fixer attempt 1", () => {
        expect(ladderRung(noCulprit())).toMatchObject({
            kind: "fix",
            attempt: 1,
        });
    });

    it("attempt 1 stuck → attempt 2", () => {
        expect(
            ladderRung(noCulprit({ episode: withAttempt({ attempt: 1 }) }))
        ).toMatchObject({ kind: "fix", attempt: 2 });
    });

    it("a record from before the ladder (no rung, no attempt) counts as attempt 1", () => {
        expect(
            ladderRung(noCulprit({ episode: withAttempt({}) }))
        ).toMatchObject({
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
                noCulprit({
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
            { sha: RED, attempt: null, culprits: [CULPRIT] },
            ...withAttempt({ attempt: MAX_FIX_ATTEMPTS }, OLD_RED),
        ].map((r) => ({ ...r, culprits: [] }));
        expect(ladderRung(facts({ episode })).kind).toBe("stop");
    });

    it("a repair landed against the standing RED waits for health", () => {
        expect(
            ladderRung(
                facts({
                    episode: withAttempt({ outcome: "handed-off", pr: 5800 }),
                })
            )
        ).toMatchObject({ kind: "wait", why: expect.stringContaining("5800") });
    });

    it("a partial landing (class guard filed for the owner) waits for health — no fix, no revert (issue #6552)", () => {
        expect(
            ladderRung(
                facts({
                    episode: withAttempt({
                        outcome: "handed-off",
                        pr: 5800,
                        classGuard: 6548,
                    }),
                })
            )
        ).toMatchObject({
            kind: "wait",
            why: expect.stringContaining("issue #6548"),
        });
    });

    it("a second RED after a partial landing follows the existing second-RED rule", () => {
        const episode: EpisodeRed[] = [
            { sha: RED, attempt: null, culprits: [] },
            ...withAttempt(
                { outcome: "handed-off", pr: 5800, classGuard: 6548 },
                OLD_RED
            ),
        ];
        expect(ladderRung(facts({ episode }))).toMatchObject({
            kind: "revert",
            why: expect.stringContaining("second RED"),
        });
    });

    it("a stuck attempt on a culprit-less RED with the bisect later naming one reaches the revert", () => {
        expect(
            ladderRung(
                facts({
                    episode: withAttempt({
                        attempt: MAX_FIX_ATTEMPTS,
                        note: "no reproduction at the tip",
                    }),
                })
            )
        ).toMatchObject({
            kind: "revert",
            culprits: [CULPRIT],
        });
    });

    it("a revert that does not apply (conflict) hands the RED to the fixer (ADR 0158 § 3)", () => {
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
            kind: "fix",
            attempt: 1,
            why: expect.stringContaining("does not apply"),
        });
    });

    it("…and never reverts again: fixer attempts used up → stop", () => {
        const episode: EpisodeRed[] = [
            {
                sha: RED,
                attempt: {
                    sha: RED,
                    rung: "revert",
                    outcome: "stuck",
                    note: "conflict",
                    at: RECENT,
                },
                culprits: [CULPRIT],
            },
            ...withAttempt({ attempt: MAX_FIX_ATTEMPTS }, OLD_RED),
        ];
        expect(ladderRung(facts({ episode }))).toMatchObject({
            kind: "stop",
            why: expect.stringContaining("does not apply"),
        });
    });

    it("…and a second RED after a fixer's landing, revert spent → stop, not a second revert", () => {
        const episode: EpisodeRed[] = [
            {
                sha: RED,
                attempt: {
                    sha: RED,
                    rung: "revert",
                    outcome: "stuck",
                    note: "conflict",
                    at: RECENT,
                },
                culprits: [CULPRIT],
            },
            ...withAttempt({ outcome: "handed-off", pr: 5800 }, OLD_RED),
        ];
        expect(ladderRung(facts({ episode })).kind).toBe("stop");
    });
});

describe("ladderRung — the revert, whenever a repair did not hold", () => {
    it("fixer attempts on the episode do not delay the revert of a named culprit", () => {
        expect(
            ladderRung(
                facts({ episode: withAttempt({ attempt: MAX_FIX_ATTEMPTS }) })
            )
        ).toMatchObject({ kind: "revert", culprits: [CULPRIT] });
    });

    it("a second RED after a landed repair → revert, no new fixer", () => {
        const episode: EpisodeRed[] = [
            { sha: RED, attempt: null, culprits: [] },
            ...withAttempt({ outcome: "handed-off", pr: 5800 }, OLD_RED),
        ];
        expect(ladderRung(facts({ episode }))).toMatchObject({
            kind: "revert",
            culprits: [CULPRIT],
            why: expect.stringContaining("second RED"),
        });
    });

    it("a second RED after a proved repair (AMBER) → revert", () => {
        expect(ladderRung(facts({ secondRed: true })).kind).toBe("revert");
    });

    it("no culprit named, both attempts stuck → stop, not a guess", () => {
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
                            culprits: [],
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
                    revertPrs: [
                        {
                            number: 5900,
                            state: "open",
                            landFailed: false,
                        },
                    ],
                })
            ).kind
        ).toBe("wait");
    });
});

describe("ladderRung — rung 6, stop", () => {
    it("a revert set past the cap stops, naming every commit in it (issue #6766)", () => {
        const names = "PR #5900, PR #5850, `abcdef012345`, PR #5700";
        const rung = ladderRung(
            facts({
                episode: withAttempt({
                    rung: "revert",
                    outcome: "stuck",
                    note: `${CAP_NOTE}${names}`,
                }),
            })
        );
        expect(rung).toMatchObject({
            kind: "stop",
            why: expect.stringContaining(`more than ${MAX_REVERT_SET}`),
        });
        const body = escalationBody({
            red: RED,
            why: rung.why,
            evidence: null,
        });
        for (const ref of [
            "PR #5900",
            "PR #5850",
            "`abcdef012345`",
            "PR #5700",
        ])
            expect(body).toContain(ref);
    });

    const reverting = withAttempt({
        rung: "revert",
        outcome: "attempting",
        pr: 5900,
    });

    it("a revert that failed for a transient reason, tries used up, stops", () => {
        expect(
            ladderRung(
                facts({
                    episode: withAttempt({
                        rung: "revert",
                        outcome: "stuck",
                        attempt: MAX_REVERT_TRIES,
                        note: `${TRANSIENT_NOTE}push refused`,
                    }),
                })
            )
        ).toMatchObject({
            kind: "stop",
            why: expect.stringContaining("push refused"),
        });
    });

    it("a revert PR the queue dequeued stops", () => {
        expect(
            ladderRung(
                facts({
                    episode: reverting,
                    revertPrs: [
                        { number: 5900, state: "open", landFailed: true },
                    ],
                })
            ).kind
        ).toBe("stop");
    });

    it("a revert PR closed unmerged stops", () => {
        expect(
            ladderRung(
                facts({
                    episode: reverting,
                    revertPrs: [
                        {
                            number: 5900,
                            state: "closed",
                            landFailed: false,
                        },
                    ],
                })
            ).kind
        ).toBe("stop");
    });

    it("a RED that outlives its merged revert stops — never a second revert", () => {
        const episode: EpisodeRed[] = [
            { sha: RED, attempt: null, culprits: [CULPRIT] },
            ...withAttempt(
                { rung: "revert", outcome: "attempting", pr: 5900 },
                OLD_RED
            ),
        ];
        expect(
            ladderRung(
                facts({
                    episode,
                    revertPrs: [
                        {
                            number: 5900,
                            state: "merged",
                            landFailed: false,
                        },
                    ],
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
        expect(parseCulprits(`# RED\n\n${line}\n`)).toEqual([CULPRIT]);
        const direct = culpritLine({
            result: { culprit: "c".repeat(40), probes: [] },
            good: null,
            commits: 1,
            subject: "a direct push",
        });
        expect(parseCulprits(direct)).toEqual([
            { sha: "c".repeat(12), pr: null },
        ]);
    });

    it("an unnamed culprit reads as none", () => {
        const line = culpritLine({
            result: { culprit: null, probes: [], reason: "no GREEN" },
            good: null,
            commits: 0,
        });
        expect(parseCulprits(line)).toEqual([]);
        expect(parseCulprits(null)).toEqual([]);
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

    it("a partial landing's class-guard issue round-trips through the commit status", () => {
        const a: FixAttempt = {
            sha: RED,
            outcome: "handed-off",
            rung: "fix",
            attempt: 1,
            machine: "macbook",
            pr: 6600,
            classGuard: 6548,
            note: "re-recorded",
        };
        const description = encodeFixDescription(a);
        expect(description).toBe(
            "HANDED-OFF · macbook · fix 1 · PR #6600 · guard #6548 · re-recorded"
        );
        expect(
            decodeFixStatus({
                sha: RED,
                state: "success",
                description,
                createdAt: null,
            })
        ).toEqual(a);
    });

    it("the reopened issue's comment carries the evidence and the fix-with-it pass (ADR 0158 § 3)", () => {
        const body = reopenComment({
            red: RED,
            culprits: [CULPRIT],
            revertPr: 5900,
            evidence: "FAIL searchCost pins",
        });
        expect(body).toContain("PR #5700");
        expect(body).toContain("PR #5900 reverts it");
        expect(body).toContain("FAIL searchCost pins");
        expect(body).toContain("WITH the fix");
        expect(body).not.toContain("fixer did not repair");
    });

    it("the revert PR closes its repair issue — what `base-health` admits it by", () => {
        const body = revertPrBody({
            issue: 6001,
            red: RED,
            culprits: [{ ...CULPRIT, full: "c".repeat(40) }],
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
        ).toMatchObject({ kind: "revert", attempt: 2, culprits: [CULPRIT] });
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

    it("a hand-off that never moved the tip counts as used after the bound", () => {
        const old = new Date(NOW - HANDED_OFF_WAIT_MS - 1).toISOString();
        expect(
            ladderRung(
                noCulprit({
                    episode: withAttempt({
                        outcome: "handed-off",
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
                    revertPrs: [
                        {
                            number: 5900,
                            state: "open",
                            landFailed: false,
                        },
                    ],
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
        expect(episode[0].culprits).toEqual([CULPRIT]);
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
                            culprits: [CULPRIT],
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
                    tip: TIP,
                    foreignRepairs: repair({ state: "merged" }),
                    sinceRed: [
                        { sha: TIP, pr: 6546, message: "repair (#6546)" },
                    ],
                    repairPrs: [6546],
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
        ).toMatchObject({ kind: "revert", attempt: 1 });
    });

    it("a declared repair with no PR yet does not hold the ladder", () => {
        expect(ladderRung(facts({ foreignRepairs: repair(null) })).kind).toBe(
            "revert"
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

describe("revertAcknowledgements — a revert of a card-shipping PR passes check:oracle (issue #6936)", () => {
    const row = (oracleId: string, name: string, state: CardRow["state"]) =>
        ({ oracleId, name, state }) as CardRow;
    // The base tip: the culprit graduated two Persist cards to `ready`.
    const base = [
        row("id-finks", "Kitchen Finks", "ready"),
        row("id-safehold", "Safehold Elite", "ready"),
        row("id-bolt", "Lightning Bolt", "ready"),
    ];
    // The revert puts them back where they were before the culprit.
    const reverted = [
        row("id-finks", "Kitchen Finks", "quarantine"),
        row("id-safehold", "Safehold Elite", "unparsed"),
        row("id-bolt", "Lightning Bolt", "ready"),
    ];
    const culprit = { sha: "7a26705010e9", pr: 6849 };
    const baseLedger = `${JSON.stringify({ note: "kept", acknowledged: [] }, null, 4)}\n`;

    it("acknowledges every ready loss, trackedBy the reopened issue, and check:oracle's diff is then clean", () => {
        const losses = readyRegressions(base, reverted);
        expect(losses).toHaveLength(2);
        const text = ledgerTextWith(
            baseLedger,
            revertAcknowledgements(losses, {
                culprits: [culprit],
                culpritIssues: [3992],
            })
        );
        const ledger = parseRegressionLedger(text);
        expect(ledger.acknowledged.map((a) => [a.name, a.trackedBy])).toEqual([
            ["Kitchen Finks", 3992],
            ["Safehold Elite", 3992],
        ]);
        expect(unacknowledgedRegressions(losses, ledger)).toEqual([]);
        expect(JSON.parse(text).note).toBe("kept");
    });

    it("a culprit that closed no issue: the drop is intended, never an untracked entry", () => {
        const losses = readyRegressions(base, reverted);
        const entries = revertAcknowledgements(losses, {
            culprits: [culprit],
            culpritIssues: [],
        });
        expect(entries.every((e) => e.intended === true)).toBe(true);
        expect(
            unacknowledgedRegressions(
                losses,
                parseRegressionLedger(ledgerTextWith(baseLedger, entries))
            )
        ).toEqual([]);
    });

    it("the ledger is rewritten in its own bytes: nothing acknowledged → unchanged; no file → an empty ledger", () => {
        expect(ledgerTextWith(baseLedger, [])).toBe(baseLedger);
        expect(ledgerTextWith(null, [])).toBe(
            `${JSON.stringify({ acknowledged: [] }, null, 4)}\n`
        );
    });

    it("a revert that drops no ready card acknowledges nothing", () => {
        expect(
            revertAcknowledgements(readyRegressions(base, base), {
                culprits: [culprit],
                culpritIssues: [3992],
            })
        ).toEqual([]);
    });
});

describe("one revert PR per culprit, none reverted twice (issue #7656)", () => {
    const A = { sha: "a1a1a1a1a1a1", pr: 7601 };
    const B = { sha: "b2b2b2b2b2b2", pr: 7602 };
    const C = { sha: "c3c3c3c3c3c3", pr: 7603 };
    const pr = (number: number, state: "open" | "merged" | "closed") => ({
        number,
        state,
        landFailed: false,
    });
    const inFlight = (prs: number[], sha = OLD_RED): FixAttempt => ({
        sha,
        rung: "revert",
        outcome: "attempting",
        attempt: 1,
        at: RECENT,
        pr: prs[0],
        prs,
    });

    it("the revert record names every PR, and reads back", () => {
        const a = inFlight([7701, 7702, 7703], RED);
        const desc = encodeFixDescription({ ...a, machine: "lane-1" });
        expect(desc).toContain("PR #7701,#7702,#7703");
        expect(
            decodeFixStatus({
                sha: RED,
                state: "pending",
                description: desc,
                createdAt: null,
            })
        ).toMatchObject({ pr: 7701, prs: [7701, 7702, 7703] });
        // One PR: the old form, read as before.
        const one = encodeFixDescription({ ...a, prs: undefined, pr: 7701 });
        expect(one).toContain("PR #7701");
        expect(
            decodeFixStatus({
                sha: RED,
                state: "pending",
                description: one,
                createdAt: null,
            })?.prs
        ).toBeUndefined();
    });

    it("a later RED naming a culprit already being reverted reverts only the new one", () => {
        // RED @ OLD_RED: A's revert PR #7701 is in the queue. The tip moved
        // on and went RED again @ RED: its bisect names A and B.
        const episode: EpisodeRed[] = [
            { sha: RED, attempt: null, culprits: [A, B] },
            { sha: OLD_RED, attempt: inFlight([7701]), culprits: [A] },
        ];
        expect(
            ladderRung(facts({ episode, revertPrs: [pr(7701, "open")] }))
        ).toMatchObject({ kind: "revert", culprits: [B], attempt: 1 });
    });

    it("every culprit covered by a revert in flight: the ladder waits on them", () => {
        const episode: EpisodeRed[] = [
            { sha: RED, attempt: inFlight([7702], RED), culprits: [A, B] },
            { sha: OLD_RED, attempt: inFlight([7701]), culprits: [A] },
        ];
        expect(
            ladderRung(
                facts({
                    episode,
                    revertPrs: [pr(7702, "open"), pr(7701, "open")],
                })
            )
        ).toMatchObject({ kind: "wait", why: /#7702, #7701 in the queue/ });
        // Same culprit named by PR only (another abbreviation): covered.
        const byPr: EpisodeRed[] = [
            {
                sha: RED,
                attempt: null,
                culprits: [{ sha: "a1a1a1a1", pr: 7601 }],
            },
            { sha: OLD_RED, attempt: inFlight([7701]), culprits: [A] },
        ];
        expect(
            ladderRung(facts({ episode: byPr, revertPrs: [pr(7701, "open")] }))
                .kind
        ).toBe("wait");
    });

    it("one PR landed, one in the queue: wait; all landed and the RED stands: stop", () => {
        const episode: EpisodeRed[] = [
            {
                sha: RED,
                attempt: inFlight([7701, 7702], RED),
                culprits: [A, B],
            },
        ];
        expect(
            ladderRung(
                facts({
                    episode,
                    revertPrs: [pr(7701, "merged"), pr(7702, "open")],
                })
            )
        ).toMatchObject({ kind: "wait", why: /#7702 in the queue/ });
        expect(
            ladderRung(
                facts({
                    episode,
                    revertPrs: [pr(7701, "merged"), pr(7702, "merged")],
                })
            )
        ).toMatchObject({ kind: "stop", why: /#7701, #7702 landed/ });
    });

    it("any one of the PRs that cannot land stops the ladder, whatever the others", () => {
        const episode: EpisodeRed[] = [
            {
                sha: RED,
                attempt: inFlight([7701, 7702, 7703], RED),
                culprits: [A, B, C],
            },
        ];
        expect(
            ladderRung(
                facts({
                    episode,
                    revertPrs: [
                        pr(7701, "merged"),
                        { ...pr(7702, "open"), landFailed: true },
                        pr(7703, "open"),
                    ],
                })
            )
        ).toMatchObject({ kind: "stop", why: /#7702 cannot land/ });
    });

    it("a newer record never resets the queue clock of an older one", () => {
        const old = new Date(NOW - REVERT_QUEUE_MAX_MS - 60_000).toISOString();
        const episode: EpisodeRed[] = [
            { sha: RED, attempt: inFlight([7702], RED), culprits: [A, B] },
            {
                sha: OLD_RED,
                attempt: { ...inFlight([7701]), at: old },
                culprits: [A],
            },
        ];
        expect(
            ladderRung(
                facts({
                    episode,
                    revertPrs: [pr(7702, "open"), pr(7701, "open")],
                })
            )
        ).toMatchObject({ kind: "stop", why: /past/ });
    });

    it("the record of an earlier RED keeps its PRs a declared repair: revertRecordsOf reads them all", () => {
        const episode: EpisodeRed[] = [
            { sha: RED, attempt: inFlight([7702], RED), culprits: [B] },
            { sha: OLD_RED, attempt: inFlight([7701]), culprits: [A] },
        ];
        expect(revertRecordsOf(episode).flatMap(prsOf)).toEqual([7702, 7701]);
    });
});

describe("revertGroups — the culprits cut into one revert PR each (issue #7656)", () => {
    const commit = (full: string) => ({
        sha: full.slice(0, 12),
        pr: null,
        full,
        subject: full,
    });
    /** A planner whose set for a group adds `deps[c]` beside each culprit. */
    function planner(
        deps: Record<string, string[]> = {},
        fail?: string
    ): {
        calls: string[][];
        plan: (g: readonly string[]) => RevertPlan;
    } {
        const calls: string[][] = [];
        return {
            calls,
            plan: (g) => {
                calls.push([...g]);
                if (fail !== undefined && g.includes(fail))
                    return {
                        kind: "conflict",
                        set: g.map(commit),
                        paths: ["x"],
                    };
                const all = [
                    ...new Set(g.flatMap((c) => [c, ...(deps[c] ?? [])])),
                ];
                return { kind: "applies", set: all.reverse().map(commit) };
            },
        };
    }

    it("culprits whose reverts apply apart: one PR each, oldest first", () => {
        const p = planner();
        const cut = revertGroups(["a", "b", "c"], p.plan);
        expect("groups" in cut && cut.groups.map((g) => g.culprits)).toEqual([
            ["a"],
            ["b"],
            ["c"],
        ]);
        expect(p.calls).toEqual([["a"], ["b"], ["c"]]);
    });

    it("a culprit another's revert depends on joins that PR, planned again as a culprit", () => {
        // `a`'s revert conflicts with `b`, a later culprit: one PR for both.
        const p = planner({ a: ["b"] });
        const cut = revertGroups(["a", "b", "c"], p.plan);
        expect("groups" in cut && cut.groups.map((g) => g.culprits)).toEqual([
            ["a", "b"],
            ["c"],
        ]);
        expect(p.calls).toEqual([["a"], ["a", "b"], ["c"]]);
    });

    it("a dependent two culprits' reverts both need: one PR for both", () => {
        // `x` is no culprit, but `a`'s and `c`'s reverts both conflict on it.
        const p = planner({ a: ["x"], c: ["x"] });
        const cut = revertGroups(["a", "b", "c"], p.plan);
        expect("groups" in cut && cut.groups.map((g) => g.culprits)).toEqual([
            ["b"],
            ["a", "c"],
        ]);
    });

    it("a revert that does not apply spends the rung, naming its culprits", () => {
        const cut = revertGroups(["a", "b"], planner({}, "b").plan);
        expect(cut).toMatchObject({
            failed: { kind: "conflict" },
            culprits: ["b"],
        });
    });
});

/**
 * Issue #7990 — the fixer ends at the hand-off, the merge comes after it
 * exits, so the ladder watches the PR its record names.
 */
describe("ladderRung — the fixer's hand-off to the queue (issue #7990)", () => {
    const handedOff = (at = RECENT) =>
        withAttempt({ outcome: "handed-off", attempt: 1, pr: 5800, at });
    const pr = (state: "open" | "merged" | "closed", landFailed = false) => [
        { number: 5800, state, landFailed },
    ];
    const old = new Date(NOW - HANDED_OFF_WAIT_MS - 1).toISOString();

    it("in the queue → wait, and nothing is withdrawn", () => {
        const f = noCulprit({ episode: handedOff(), fixPrs: pr("open") });
        expect(ladderRung(f)).toMatchObject({
            kind: "wait",
            why: expect.stringContaining("in the queue"),
        });
        expect(spentHandOffs(f)).toEqual([]);
    });

    it("merged → wait for health on its tip", () => {
        const f = noCulprit({ episode: handedOff(), fixPrs: pr("merged") });
        expect(ladderRung(f)).toMatchObject({
            kind: "wait",
            why: expect.stringContaining("health confirms"),
        });
        expect(spentHandOffs(f)).toEqual([]);
    });

    it("`land-failed` → a used attempt, and the PR is withdrawn before the next rung", () => {
        const f = noCulprit({ episode: handedOff(), fixPrs: pr("open", true) });
        expect(ladderRung(f)).toMatchObject({ kind: "fix", attempt: 2 });
        expect(spentHandOffs(f)).toEqual([5800]);
    });

    it("closed unmerged → a used attempt, nothing left to withdraw", () => {
        const f = noCulprit({ episode: handedOff(), fixPrs: pr("closed") });
        expect(ladderRung(f)).toMatchObject({ kind: "fix", attempt: 2 });
        expect(spentHandOffs(f)).toEqual([]);
    });

    it("held in the queue past the bound → a used attempt, the PR withdrawn", () => {
        const f = noCulprit({ episode: handedOff(old), fixPrs: pr("open") });
        expect(ladderRung(f)).toMatchObject({ kind: "fix", attempt: 2 });
        expect(spentHandOffs(f)).toEqual([5800]);
    });

    it("merged and no verdict within the bound → a used attempt, no PR to withdraw", () => {
        const f = noCulprit({ episode: handedOff(old), fixPrs: pr("merged") });
        expect(ladderRung(f)).toMatchObject({ kind: "fix", attempt: 2 });
        expect(spentHandOffs(f)).toEqual([]);
    });

    it("a named culprit is reverted once the hand-off is spent", () => {
        const f = facts({
            episode: handedOff().map((r) => ({ ...r, culprits: [CULPRIT] })),
            fixPrs: pr("closed"),
        });
        expect(ladderRung(f).kind).toBe("revert");
    });

    it("a hand-off on an older RED still in the queue waits — it is no second RED", () => {
        const episode: EpisodeRed[] = [
            { sha: RED, attempt: null, culprits: [CULPRIT] },
            ...withAttempt(
                { outcome: "handed-off", attempt: 1, pr: 5800, at: RECENT },
                OLD_RED
            ),
        ];
        expect(ladderRung(facts({ episode, fixPrs: pr("open") })).kind).toBe(
            "wait"
        );
        expect(
            ladderRung(facts({ episode, fixPrs: pr("merged") }))
        ).toMatchObject({
            kind: "revert",
            why: expect.stringContaining("second RED"),
        });
    });

    it("never withdraws a revert PR in flight: it names fix records only", () => {
        const f = facts({
            episode: withAttempt({
                outcome: "handed-off",
                rung: "revert",
                attempt: 1,
                pr: 5800,
                at: RECENT,
            }),
            revertPrs: pr("open", true),
        });
        expect(spentHandOffs(f)).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// A Contained RED becomes blocking (ADR 0163 § 5, issue #8077)
// ─────────────────────────────────────────────────────────────────────────────

describe("escalationOf — a Contained RED becomes blocking by event or landing cap", () => {
    const contained = (over: Partial<LadderFacts> = {}) =>
        facts({ contained: true, landingsSinceFirstRed: 0, ...over });
    const escalate = (f: LadderFacts) => escalationOf(f, ladderRung(f));

    it("a blocking RED has nothing to escalate", () => {
        const f = facts({ landingsSinceFirstRed: 99 });
        expect(escalationOf(f, { kind: "stop", why: "x" })).toBeNull();
    });

    it("the ladder's stop rung escalates", () => {
        const f = contained({
            episode: withAttempt({ rung: "revert", outcome: "handed-off" }),
        });
        expect(escalationOf(f, { kind: "stop", why: "cannot land" })).toEqual({
            trigger: "stop",
            why: expect.stringContaining("cannot land"),
        });
    });

    it("a stop already recorded (hold) still escalates — the transition may not have been written", () => {
        const f = contained({ escalated: 42 });
        expect(ladderRung(f).kind).toBe("hold");
        expect(escalate(f)?.trigger).toBe("stop");
    });

    it("a revert that does not apply escalates", () => {
        const f = contained({
            episode: withAttempt({ rung: "revert", outcome: "stuck" }),
        });
        expect(revertDoesNotApply(f)).toBe(true);
        expect(escalate(f)?.trigger).toBe("revert-not-applied");
    });

    it("a transient revert failure or the revert-set cap is not 'does not apply'", () => {
        for (const note of [`${TRANSIENT_NOTE}network`, `${CAP_NOTE}5 commits`])
            expect(
                revertDoesNotApply(
                    contained({
                        episode: withAttempt({
                            rung: "revert",
                            outcome: "stuck",
                            note,
                        }),
                    })
                )
            ).toBe(false);
    });

    it("the landing cap escalates at LANDINGS_PER_BATCH, not before", () => {
        expect(
            escalate(
                contained({ landingsSinceFirstRed: LANDINGS_PER_BATCH - 1 })
            )
        ).toBeNull();
        expect(
            escalate(contained({ landingsSinceFirstRed: LANDINGS_PER_BATCH }))
        ).toMatchObject({ trigger: "landing-cap" });
    });

    it("an unreadable landing count escalates nothing", () => {
        expect(escalate(contained({ landingsSinceFirstRed: null }))).toBeNull();
    });

    it("elapsed time alone never escalates", () => {
        const waiting = contained({
            // A fixer attempt running for a month: a wait, no event.
            episode: withAttempt({
                rung: "fix",
                outcome: "attempting",
                at: new Date(NOW - 30 * 86_400_000).toISOString(),
            }),
            now: NOW + 30 * 86_400_000,
        });
        expect(ladderRung(waiting).kind).not.toBe("stop");
        const quiet = contained({ now: NOW + 365 * 86_400_000 });
        expect(escalate(quiet)).toBeNull();
    });

    it("the cap counts from the episode's FIRST RED, across a second RED with new names", () => {
        const episode: EpisodeRed[] = [
            { sha: RED, attempt: null, culprits: [CULPRIT] },
            { sha: OLD_RED, attempt: null, culprits: [] },
        ];
        expect(episodeFirstRed(episode)?.sha).toBe(OLD_RED);
        expect(episodeFirstRed([])).toBeNull();
        // 12 landings before the second RED + 9 after it: the count the I/O
        // reads from OLD_RED is 21, never reset by the second RED.
        expect(
            escalate(contained({ episode, landingsSinceFirstRed: 12 + 9 }))
        ).toMatchObject({
            trigger: "landing-cap",
            why: expect.stringContaining(OLD_RED.slice(0, 8)),
        });
    });
});

describe("a Contained RED made blocking — the queue is held by the re-gate", () => {
    const red = (sha: string, redClass?: "contained"): Verdict => ({
        sha,
        status: "red",
        step: "test",
        tests: ["convex/gre/__tests__/x.test.ts"],
        failure: "assertion",
        ...(redClass ? { redClass } : {}),
    });

    it("lineageOf answers contained before and red after", () => {
        const before = lineageOf([red(RED, "contained")]);
        expect(before.kind).toBe("contained");
        expect(lineageBlocks(before.kind)).toBe(false);
        const stored = withoutClass(
            red(RED, "contained"),
            "2026-11-04T12:00:00Z"
        );
        expect(stored.redClass).toBeUndefined();
        const after = lineageOf([stored]);
        expect(after.kind).toBe("red");
        expect(lineageBlocks(after.kind)).toBe(true);
    });

    it("survives the commit-status description round trip", () => {
        const written = encodeDescription(
            withoutClass(red(RED, "contained"), "2026-11-04T12:00:00Z")
        );
        const read = decodeStatus({
            state: "failure",
            description: written,
        } as never);
        expect(read?.redClass).toBeUndefined();
        expect(lineageOf(read ? [{ ...read, sha: RED }] : []).kind).toBe("red");
    });

    it("an older RED of the episode keeps the head, not the class, deciding", () => {
        // The head rewritten blocking: contained older REDs cannot make it so.
        const head = withoutClass(red(RED, "contained"), "t");
        expect(lineageOf([head, red(OLD_RED, "contained")]).kind).toBe("red");
    });
});

describe("verdictRunFails — a Contained RED sends no email; the transition sends one", () => {
    it("a ladder that succeeded fails nothing", () => {
        expect(verdictRunFails({ ladderSucceeded: true, kind: "red" })).toBe(
            false
        );
    });

    it("a Contained RED fails no run", () => {
        expect(
            verdictRunFails({ ladderSucceeded: false, kind: "contained" })
        ).toBe(false);
    });

    it("a blocking RED, INFRA or nothing fails the run", () => {
        for (const kind of ["red", "second-red", "infra", "none"] as const)
            expect(verdictRunFails({ ladderSucceeded: false, kind })).toBe(
                true
            );
    });

    it("an unreadable lineage fails: an email is never dropped on a missing fact", () => {
        expect(
            verdictRunFails({
                ladderSucceeded: false,
                kind: "none",
                readError: "502",
            })
        ).toBe(true);
    });

    it("the transition fails exactly one run: once blocking, the next escalation is null", () => {
        const f = facts({
            contained: true,
            landingsSinceFirstRed: LANDINGS_PER_BATCH,
        });
        expect(escalationOf(f, ladderRung(f))).not.toBeNull();
        // After the rewrite the lineage is `red`: `contained` is false.
        const after = { ...f, contained: false };
        expect(escalationOf(after, ladderRung(after))).toBeNull();
    });
});

// ADR 0163 §§ 2-3, one fixture per shape of the 2026-10-28 census: the real
// evidence builder and the real culprit lines, never a hand-written body.
describe("the bisect grants Contained RED (ADR 0163 §§ 2-3)", () => {
    const BOT_FILE = "convex/gre/ai/blade/pins.bot.test.ts";
    const TOOLING_FILE = "scripts/__tests__/check-lane.test.ts";
    const COMMITS = ["1".repeat(40), "2".repeat(40), RED];
    const SUBJECTS: Record<string, string> = {
        [COMMITS[0]]: "feat: an ordinary PR (#7001)",
        [COMMITS[1]]: BASE_MAINTENANCE_SUBJECTS[0],
        [RED]: "feat: another PR (#7002)",
    };
    const subjectOf = (sha: string) => SUBJECTS[sha];

    const vitestOutput = (...tests: [file: string, name: string][]) =>
        [
            ...tests.map(
                ([file, name]) =>
                    ` FAIL  |node| ${file} > suite > ${name}\nAssertionError: expected 1 to be 2`
            ),
            ` Test Files  ${tests.length} failed (${tests.length})`,
            `      Tests  ${tests.length} failed (${tests.length})`,
        ].join("\n");

    const body = (output: string, step = "test", status = 1) =>
        buildEvidence({
            sha: RED,
            step,
            machine: "m",
            logPath: "/log",
            output,
            status,
            signal: null,
            at: RECENT,
        });

    const lines = (report: CulpritReport) =>
        culpritLines({
            report,
            total: 1,
            good: "0".repeat(40),
            commits: COMMITS.length,
            subjectOf,
        });

    const report = (culprit: string): CulpritReport =>
        attributeMaintenance(
            {
                found: [{ culprit, tests: [{ file: BOT_FILE }] }],
                unexplained: null,
                probes: [],
            },
            COMMITS,
            subjectOf
        );

    /** The real bisect, its probes reading every commit green. */
    const noProbeReproduced = (): CulpritReport =>
        bisectCulprits(COMMITS, [{ file: BOT_FILE, name: "pin" }], () => []);

    const withLines = (ev: string, culpritBullets: readonly string[]) =>
        culpritBullets.reduce((b, l) => withEvidenceLine(b, l), ev);

    const botPin = () => body(vitestOutput([BOT_FILE, "pin"]));

    const grantOf = (
        ev: ReturnType<typeof body>,
        culpritBullets: readonly string[],
        over: {
            step?: string;
            lineage?: Parameters<typeof containedGrant>[0]["lineage"];
        } = {}
    ) =>
        containedGrant({
            verdict: {
                status: "red",
                step: over.step ?? "test",
                failure: ev.kind,
            },
            evidence: withLines(ev.body, culpritBullets),
            lineage: over.lineage === undefined ? "red" : over.lineage,
        });

    const named = () => lines(report(COMMITS[0]));

    it("a Bot pin bisected to an ordinary PR grants, and owes no P0 (episode 9)", () => {
        expect(grantOf(botPin(), named())).toEqual({
            grant: true,
            noCulprit: false,
        });
    });

    it("a retried test step is still the `test` step", () => {
        expect(
            grantOf(botPin(), named(), { step: "test (retry: node, timeout)" })
                .grant
        ).toBe(true);
    });

    it("a failed derive:sync step refuses (episode 15)", () => {
        const ev = body("derive:sync: refused", "derive:sync");
        const grant = grantOf(
            ev,
            [
                `- **culprit:** not bisected — a failed \`derive:sync\` names no test file`,
            ],
            { step: "derive:sync" }
        );
        expect(grant).toEqual({
            grant: false,
            why: expect.stringContaining("derive:sync"),
        });
    });

    it("a failing test of the pipeline's own tooling refuses (episode 12)", () => {
        const ev = body(vitestOutput([TOOLING_FILE, "plans"]));
        expect(grantOf(ev, named())).toEqual({
            grant: false,
            why: expect.stringContaining("tooling"),
        });
    });

    it("one tooling test among ordinary ones refuses", () => {
        const ev = body(
            vitestOutput([BOT_FILE, "pin"], [TOOLING_FILE, "plans"])
        );
        expect(grantOf(ev, named()).grant).toBe(false);
    });

    it("a culprit the first red probe reached through a generated commit refuses (episode 4)", () => {
        const via = lines(report(COMMITS[1]));
        expect(via[0]).toContain("PR #7001");
        expect(grantOf(botPin(), via)).toEqual({
            grant: false,
            why: expect.stringContaining("generated"),
        });
    });

    it("a generated first red probe with no PR before it refuses", () => {
        const none = attributeMaintenance(
            {
                found: [{ culprit: COMMITS[1], tests: [{ file: BOT_FILE }] }],
                unexplained: null,
                probes: [],
            },
            COMMITS.slice(1),
            subjectOf
        );
        expect(grantOf(botPin(), lines(none)).grant).toBe(false);
    });

    it("every probe green and no culprit named grants with a P0 (episode 13)", () => {
        const culprits = lines(noProbeReproduced());
        expect(culprits).toHaveLength(1);
        expect(grantOf(botPin(), culprits)).toEqual({
            grant: true,
            noCulprit: true,
        });
    });

    it("a second RED refuses", () => {
        expect(grantOf(botPin(), named(), { lineage: "second-red" })).toEqual({
            grant: false,
            why: expect.stringContaining("second RED"),
        });
    });

    it("a dead bisect refuses: a probe that could not run", () => {
        const dead = bisectCulprits(
            COMMITS,
            [{ file: BOT_FILE, name: "pin" }],
            () => "infra"
        );
        expect(grantOf(botPin(), lines(dead)).grant).toBe(false);
    });

    it("a dead bisect refuses: no culprit line was ever published", () => {
        expect(grantOf(botPin(), [])).toEqual({
            grant: false,
            why: expect.stringContaining("no culprit line"),
        });
    });

    it("a bisect with no GREEN to start from refuses", () => {
        const noGreen = [
            `- **culprit:** not named — no GREEN in the 100 commits before \`${RED.slice(0, 12)}\``,
        ];
        expect(grantOf(botPin(), noGreen).grant).toBe(false);
    });

    it("a RED whose fresh run failed elsewhere was never bisected, and refuses", () => {
        const elsewhere = [
            "- **culprit:** not bisected — the fresh run passed the failing part, but `test:bot` (never reached by the RED's run) failed",
        ];
        expect(grantOf(botPin(), elsewhere).grant).toBe(false);
    });

    it("a crash beside failing tests refuses: the kind is not an assertion", () => {
        const ev = body(
            `${vitestOutput([BOT_FILE, "pin"])}\nError: Worker exited unexpectedly`
        );
        const crashed = containedGrant({
            verdict: { status: "red", step: "test", failure: "crash" },
            evidence: withLines(ev.body, named()),
            lineage: "red",
        });
        expect(crashed).toEqual({
            grant: false,
            why: expect.stringContaining("crash"),
        });
    });

    it("a failing file with no test name refuses: the lane could not tolerate it", () => {
        const ev = body(
            `${vitestOutput([BOT_FILE, "pin"])}\n FAIL  |node| convex/load.test.ts`
        );
        expect(grantOf(ev, named())).toEqual({
            grant: false,
            why: expect.stringContaining("convex/load.test.ts"),
        });
    });

    it("an unread lineage refuses", () => {
        expect(grantOf(botPin(), named(), { lineage: null }).grant).toBe(false);
    });

    // The I/O scripts have no harness of their own: a grant or an inheritance
    // no script calls would leave every test above green and the switch off.
    describe("the wiring", () => {
        const source = (name: string) =>
            readFileSync(join(import.meta.dirname, "..", name), "utf8");

        it("the ladder grants right after it publishes the culprit lines", () => {
            expect(source("health-bisect.ts")).toMatch(
                /publishCulprit\(ctx, lines\);\s+if \(!ctx\.dryRun\) grantContained\(ctx\);\s+return 1;/
            );
        });

        it("health-main writes the inherited class on the RED", () => {
            expect(source("health-main.ts")).toMatch(
                /\.\.\.\(redClass \? \{ redClass \} : \{\}\),/
            );
        });
    });

    describe("the tooling list", () => {
        const DIR = join(import.meta.dirname);
        // The families that ARE the machinery: a new test in one must be
        // listed. The list also names single files outside them.
        const FAMILY =
            /^(base-drift|check-lane|contained|gate|land|lane|pr-|pre-queue|queue|release|repair-proof)[a-z-]*\.test\.ts$/;

        it("every entry exists", () => {
            const root = join(DIR, "..", "..");
            expect(
                PIPELINE_TOOLING_TESTS.filter((f) => !existsSync(join(root, f)))
            ).toEqual([]);
        });

        it("every test of a machinery family is listed", () => {
            const missing = readdirSync(DIR)
                .filter((f) => FAMILY.test(f))
                .map((f) => `scripts/__tests__/${f}`)
                .filter((f) => !PIPELINE_TOOLING_TESTS.includes(f));
            expect(missing).toEqual([]);
        });
    });

    describe("settleContainedGrant — the write, and the one P0 of an episode", () => {
        const STORED: Verdict = {
            sha: RED,
            status: "red",
            step: "test",
            failure: "assertion",
            machine: "m",
        };
        const FIRST = "e".repeat(40);

        function world(over: {
            verdict?: Verdict | null;
            evidence?: string | null;
            reds?: Verdict[];
            kind?: Parameters<typeof containedGrant>[0]["lineage"];
            written?: boolean;
            issues?: Map<string, number>;
        }) {
            const issues = over.issues ?? new Map<string, number>();
            const log = {
                writes: [] as Verdict[],
                filed: [] as { title: string; body: string }[],
                declared: [] as number[],
                notes: [] as string[],
            };
            const fx: ContainedGrantEffects = {
                note: (l) => log.notes.push(l),
                readVerdict: () =>
                    over.verdict === undefined ? STORED : over.verdict,
                readLineage: () => ({
                    kind: over.kind ?? "red",
                    verdict: STORED,
                    reds: over.reds ?? [STORED],
                    ...(over.kind === null ? { error: "down" } : {}),
                }),
                readEvidence: () =>
                    over.evidence === undefined
                        ? withLines(botPin().body, named())
                        : over.evidence,
                write: (v) => {
                    log.writes.push(v);
                    return over.written === false
                        ? { written: false, reason: "declined" }
                        : { written: true };
                },
                findIssue: (t) => issues.get(t) ?? null,
                fileIssue: (title, b) => {
                    log.filed.push({ title, body: b });
                    const n = 9000 + issues.size;
                    issues.set(title, n);
                    return n;
                },
                declareRepair: (n) => log.declared.push(n),
                now: () => RECENT,
            };
            return { fx, log };
        }

        const noCulpritEvidence = () =>
            withLines(botPin().body, lines(noProbeReproduced()));

        it("a grant writes the same RED with its class, and it reads back as contained", () => {
            const { fx, log } = world({});
            expect(settleContainedGrant(RED, fx)).toBe(true);
            expect(log.writes).toEqual([
                { ...STORED, redClass: "contained", at: RECENT },
            ]);
            expect(lineageOf(log.writes).kind).toBe("contained");
            expect(log.filed).toEqual([]);
        });

        it("a refusal writes nothing: the RED keeps blocking", () => {
            const { fx, log } = world({ kind: "second-red" });
            expect(settleContainedGrant(RED, fx)).toBe(false);
            expect(log.writes).toEqual([]);
            expect(lineageBlocks(lineageOf([STORED]).kind)).toBe(true);
        });

        it("a dead bisect leaves the RED blocking", () => {
            const { fx, log } = world({ evidence: botPin().body });
            expect(settleContainedGrant(RED, fx)).toBe(false);
            expect(log.writes).toEqual([]);
        });

        it("a read that throws leaves the RED blocking and does not throw", () => {
            const { fx, log } = world({});
            fx.readEvidence = () => {
                throw new Error("the pivot is down");
            };
            expect(settleContainedGrant(RED, fx)).toBe(false);
            expect(log.writes).toEqual([]);
            expect(log.notes.join()).toContain("the pivot is down");
        });

        it("an unread lineage leaves the RED blocking", () => {
            const { fx, log } = world({ kind: null });
            expect(settleContainedGrant(RED, fx)).toBe(false);
            expect(log.writes).toEqual([]);
        });

        it("no culprit files one P0: bug + area:workflow carry it, never a ## Band line", () => {
            const { fx, log } = world({ evidence: noCulpritEvidence() });
            expect(settleContainedGrant(RED, fx)).toBe(true);
            expect(log.filed).toHaveLength(1);
            expect(log.filed[0].title).toBe(noCulpritIssueTitle(RED));
            expect(log.filed[0].body).not.toMatch(/^##\s*Band/im);
            expect(log.filed[0].body).toContain(RED);
            expect(log.declared).toEqual([9000]);
        });

        it("the body never carries a band, whatever the evidence says", () => {
            const b = noCulpritIssueBody({
                red: RED,
                evidence: `${botPin().body}\n## Band\n\nP0 — no`,
            });
            expect(b).not.toMatch(/^##\s*Band/im);
        });

        it("a second no-culprit RED of the episode files no second P0, keyed on the first RED", () => {
            const issues = new Map<string, number>();
            const reds = [{ ...STORED, sha: FIRST }];
            const first = world({
                evidence: noCulpritEvidence(),
                reds,
                issues,
            });
            settleContainedGrant(FIRST, first.fx);
            const second = world({
                evidence: noCulpritEvidence(),
                reds: [STORED, ...reds],
                issues,
            });
            settleContainedGrant(RED, second.fx);
            expect(first.log.filed).toHaveLength(1);
            expect(second.log.filed).toEqual([]);
            expect(second.log.writes).toHaveLength(1);
        });

        it("an unread dedup key files nothing, and the grant stands", () => {
            const { fx, log } = world({ evidence: noCulpritEvidence() });
            fx.findIssue = () => {
                throw new Error("gh is down");
            };
            expect(settleContainedGrant(RED, fx)).toBe(true);
            expect(log.filed).toEqual([]);
        });

        it("a RED that inherited the class is left alone", () => {
            const { fx, log } = world({
                verdict: { ...STORED, redClass: "contained" },
                evidence: noCulpritEvidence(),
            });
            expect(settleContainedGrant(RED, fx)).toBe(false);
            expect(log.writes).toEqual([]);
            expect(log.filed).toEqual([]);
        });

        it("an ordinary culprit whose revert did not clear it is contained, then blocking through the escalation (episode 11)", () => {
            const { fx, log } = world({});
            expect(settleContainedGrant(RED, fx)).toBe(true);
            expect(lineageBlocks(lineageOf(log.writes).kind)).toBe(false);
            const f = facts({
                contained: lineageOf(log.writes).kind === "contained",
                landingsSinceFirstRed: 1,
                episode: [
                    {
                        sha: RED,
                        culprits: [CULPRIT],
                        attempt: {
                            sha: RED,
                            rung: "revert",
                            outcome: "handed-off",
                            pr: 7701,
                            at: RECENT,
                        },
                    },
                ],
                revertPrs: [
                    { number: 7701, state: "merged", landFailed: false },
                ],
            });
            const rung = ladderRung(f);
            expect(rung.kind).toBe("stop");
            expect(escalationOf(f, rung)?.trigger).toBe("stop");
            expect(
                lineageBlocks(
                    lineageOf([withoutClass(log.writes[0], RECENT)]).kind
                )
            ).toBe(true);
        });
    });

    describe("inheritedClass — at write time", () => {
        const standing: Verdict = {
            sha: OLD_RED,
            status: "red",
            step: "test",
            failure: "assertion",
            redClass: "contained",
        };
        const standingBody = body(
            vitestOutput([BOT_FILE, "pin"], [BOT_FILE, "other"])
        ).body;
        const inherit = (
            output: string,
            over: {
                step?: string;
                failure?: string;
                evidence?: string | null;
                kind?: Parameters<typeof containedGrant>[0]["lineage"];
                standingEvidence?: string | null;
            } = {}
        ) => {
            const ev = body(output);
            return inheritedClass({
                verdict: {
                    step: over.step ?? "test",
                    failure: over.failure ?? ev.kind,
                },
                evidence: over.evidence === undefined ? ev.body : over.evidence,
                lineage: () =>
                    over.kind === null
                        ? { kind: "none", verdict: null, error: "down" }
                        : {
                              kind: over.kind ?? "contained",
                              verdict: standing,
                              reds: [standing],
                          },
                standingEvidence: () =>
                    over.standingEvidence === undefined
                        ? standingBody
                        : over.standingEvidence,
            });
        };

        it("the same names inherit, and a subset does", () => {
            expect(
                inherit(vitestOutput([BOT_FILE, "pin"], [BOT_FILE, "other"]))
            ).toBe("contained");
            expect(inherit(vitestOutput([BOT_FILE, "pin"]))).toBe("contained");
        });

        it("a new name blocks until its own bisect", () => {
            expect(
                inherit(vitestOutput([BOT_FILE, "pin"], [BOT_FILE, "new one"]))
            ).toBeUndefined();
        });

        it("the same name in another file is another test", () => {
            expect(
                inherit(vitestOutput(["convex/other.test.ts", "pin"]))
            ).toBeUndefined();
        });

        it("a blocking lineage gives nothing to inherit: an escalation is not undone", () => {
            for (const kind of ["red", "second-red", "green"] as const)
                expect(
                    inherit(vitestOutput([BOT_FILE, "pin"]), { kind })
                ).toBeUndefined();
        });

        it("a failure of another shape never inherits", () => {
            const out = vitestOutput([BOT_FILE, "pin"]);
            expect(inherit(out, { step: "check:all" })).toBeUndefined();
            expect(inherit(out, { failure: "crash" })).toBeUndefined();
        });

        it("an unread fact never inherits, and does not throw", () => {
            const out = vitestOutput([BOT_FILE, "pin"]);
            expect(inherit(out, { evidence: null })).toBeUndefined();
            expect(inherit(out, { kind: null })).toBeUndefined();
            expect(inherit(out, { standingEvidence: null })).toBeUndefined();
            expect(
                inheritedClass({
                    verdict: { step: "test", failure: "assertion" },
                    evidence: body(out).body,
                    lineage: () => {
                        throw new Error("down");
                    },
                    standingEvidence: () => standingBody,
                })
            ).toBeUndefined();
        });
    });
});
