import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    buildClaimRow,
    claimDecision,
    claimLockVerdict,
    latestPlanFor,
    liveClaimSet,
    ownsClaimLock,
    parsePpidComm,
} from "../lib/queue-claim";
import { capCensus, isStaleClaim } from "../lib/queue-plan";
import {
    classifyClaims,
    type ClaimVerdictState,
    type ProcessProbe,
} from "../loop-doctor";

/**
 * `queue:claim` — the claim as ONE locked act (issue #4375, PRD #4373).
 *
 * The cap was a read (`queue:plan`) followed by a hand-typed write, and two
 * sessions in the window both passed it. These tests pin the decision the
 * verb makes UNDER the lock, the stale rule it shares with the planner, the
 * journal row every reader of `claims.jsonl` depends on, the lock verdict —
 * and, once, the lock itself: two real processes racing it serialise.
 */

describe("queue:claim — the decision (issue #4375)", () => {
    it("refuses a collision outright — another live session holds the issue", () => {
        const d = claimDecision({
            issue: 20,
            live: [10, 20],
            cap: 3,
            noCap: false,
        });
        expect(d.admitted).toBe(false);
        if (!d.admitted) {
            expect(d.refusal).toBe("claimed");
            expect(d.message).toMatch(/#20/);
            expect(d.message).toMatch(/next issue/);
        }
    });

    it("a collision is NOT escapable by --no-cap — the flag argues with the cap, not with live work", () => {
        const d = claimDecision({ issue: 20, live: [20], cap: 3, noCap: true });
        expect(d.admitted).toBe(false);
        if (!d.admitted) expect(d.refusal).toBe("claimed");
    });

    it("refuses at the cap with the planner's own refusal — the two verbs cannot disagree", () => {
        const d = claimDecision({
            issue: 40,
            live: [10, 20, 30],
            cap: 3,
            noCap: false,
        });
        expect(d.admitted).toBe(false);
        if (!d.admitted) {
            expect(d.refusal).toBe("cap");
            expect(d.message).toMatch(/3\/3 live claims/);
            expect(d.message).toMatch(/--no-cap/);
        }
    });

    it("admits below the cap, and past it under --no-cap", () => {
        expect(
            claimDecision({ issue: 40, live: [10, 20], cap: 3, noCap: false })
        ).toEqual({
            admitted: true,
        });
        expect(
            claimDecision({
                issue: 40,
                live: [10, 20, 30],
                cap: 3,
                noCap: true,
            })
        ).toEqual({ admitted: true });
    });
});

describe("queue:claim — the live set: the planner's stale rule over every in-progress issue (issue #4375)", () => {
    const now = "2026-09-22T12:00:00Z";
    const fresh = "2026-09-22T11:00:00Z";
    const old = "2026-09-20T11:00:00Z"; // 49 h before `now`

    it("counts an in-progress issue with no PR and recent activity", () => {
        expect(
            liveClaimSet(
                [{ number: 10, updatedAt: fresh }],
                [],
                [],
                now,
                24,
                isStaleClaim
            )
        ).toEqual([10]);
    });

    it("drops a STALE claim — no open PR, untouched past staleClaimHours — exactly as the planner does", () => {
        // The planner defers this issue as a stale claim and excludes it from
        // `activeClaims`; counting it here would let three abandoned labels
        // refuse every claim with no session running at all.
        expect(
            liveClaimSet(
                [{ number: 10, updatedAt: old }],
                [],
                [],
                now,
                24,
                isStaleClaim
            )
        ).toEqual([]);
    });

    it("keeps an old claim ALIVE when its PR is open — age is not evidence against a PR", () => {
        expect(
            liveClaimSet(
                [{ number: 10, updatedAt: old }],
                [10],
                [],
                now,
                24,
                isStaleClaim
            )
        ).toEqual([10]);
    });

    it("subtracts what the journal says this machine released, and de-duplicates", () => {
        expect(
            liveClaimSet(
                [
                    { number: 10, updatedAt: fresh },
                    { number: 10, updatedAt: fresh },
                    { number: 20, updatedAt: fresh },
                ],
                [],
                [20],
                now,
                24,
                isStaleClaim
            )
        ).toEqual([10]);
    });
});

describe("queue:claim — the lock verdict (issue #4375)", () => {
    const owner = { pid: 4242, ts: 1_000_000, label: "claim #1" };

    it("waits on a live holder within the stale window", () => {
        expect(claimLockVerdict(owner, 1_010_000, 30_000, true)).toBe("wait");
    });

    it("reclaims a holder whose process is gone", () => {
        expect(claimLockVerdict(owner, 1_010_000, 30_000, false)).toBe(
            "reclaim-dead"
        );
    });

    it("NEVER reclaims a live holder, however long it has held — a slow gh is not a dead process", () => {
        // A waiter that deleted a live holder's lock would put two processes
        // inside the locked body at once — the state the lock exists to
        // forbid — and the first one's release would then remove the second
        // one's lock. A hung live holder is the bounded wait's to report.
        expect(claimLockVerdict(owner, 1_031_000, 30_000, true)).toBe("wait");
        expect(claimLockVerdict(owner, 9_999_999, 30_000, true)).toBe("wait");
    });

    it("WAITS on an unreadable owner file inside the window — it is a lock mid-write", () => {
        expect(
            claimLockVerdict(null, 1_010_000, 30_000, false, 1_000_000)
        ).toBe("wait");
        // No directory age known at all: wait, never guess.
        expect(claimLockVerdict(null, 1_031_000, 30_000, false, null)).toBe(
            "wait"
        );
    });

    it("reclaims an owner-less directory past the window — a stamp that never came", () => {
        // A crash between `mkdir` and the stamp. Without this clause every
        // later claim on the machine waits on it until a human removes it.
        expect(
            claimLockVerdict(null, 1_031_000, 30_000, false, 1_000_000)
        ).toBe("reclaim-orphan");
    });

    it("a process releases ONLY a lock stamped with its own pid", () => {
        expect(ownsClaimLock({ pid: 42, ts: 1, label: "x" }, 42)).toBe(true);
        expect(ownsClaimLock({ pid: 42, ts: 1, label: "x" }, 43)).toBe(false);
        expect(ownsClaimLock(null, 42)).toBe(false);
    });
});

describe("queue:claim — the journal row is the hook's row (issue #4375, #2518, #2627)", () => {
    it("writes the same fields claim-ledger.sh writes, plus `via`", () => {
        const row = buildClaimRow({
            now: 1_700_000_000,
            session: "sess-1",
            issue: 20,
            planId: "sess-1-1700000000000.json",
            planned: [20, 30],
            owner: { pid: 99, startedAt: "Tue Sep 22 09:00:00 2026" },
        });
        expect(row).toEqual({
            ts: 1_700_000_000,
            session: "sess-1",
            issue: 20,
            event: "claim",
            plan: "sess-1-1700000000000.json",
            planMismatch: null,
            owner: { pid: 99, startedAt: "Tue Sep 22 09:00:00 2026" },
            via: "queue:claim",
        });
    });

    it("reports — never blocks — a claim outside the plan's admitted batch", () => {
        const row = buildClaimRow({
            now: 1,
            session: "sess-1",
            issue: 40,
            planId: "sess-1-1.json",
            planned: [20, 30],
            owner: null,
        });
        expect(row.planMismatch).toEqual({ claimed: 40, planned: [20, 30] });
    });

    it("records `plan: null` and no mismatch when no plan preceded the claim", () => {
        const row = buildClaimRow({
            now: 1,
            session: "sess-1",
            issue: 40,
            planId: null,
            planned: null,
            owner: null,
        });
        expect(row.plan).toBeNull();
        expect(row.planMismatch).toBeNull();
    });

    it("picks the LATEST plan of THIS session by name, and none for an empty session id", () => {
        const names = [
            "sess-1-1700000000000.json",
            "sess-2-1700000005000.json",
            "sess-1-1700000003000.json",
            "unknown-1700000009000.json",
        ];
        expect(latestPlanFor("sess-1", names)).toBe(
            "sess-1-1700000003000.json"
        );
        expect(latestPlanFor("sess-3", names)).toBeNull();
        expect(latestPlanFor("", names)).toBeNull();
    });

    it("parses a `ps -o ppid=,comm=` line to the parent pid and the command basename", () => {
        expect(parsePpidComm("  123 /usr/local/bin/claude")).toEqual({
            ppid: 123,
            comm: "claude",
        });
        expect(parsePpidComm("1 launchd")).toEqual({
            ppid: 1,
            comm: "launchd",
        });
        expect(parsePpidComm("")).toBeNull();
        expect(parsePpidComm("PPID COMM")).toBeNull();
    });
});

describe("queue:claim — the cap counts LIVE SESSIONS, not labels (issue #4384)", () => {
    // The 2026-09-22 shape: two `loop-drain` passes died mid-issue leaving
    // three claims standing, `ps` showed zero owning processes, `loop:doctor`
    // printed `2 RECOVERABLE` — and the next claim was still refused at
    // `3/3 live claims` with no session running at all. The classifier had the
    // evidence; the cap never asked for it.
    const verdicts = (rows: [number, ClaimVerdictState][]) => new Map(rows);

    it("admits at a cap of 3 when two of the three claims classify `recoverable`, and reports 1 live", () => {
        const census = capCensus(
            [10, 20, 30],
            verdicts([
                [10, "live"],
                [20, "recoverable"],
                [30, "recoverable"],
            ])
        );
        expect(census).toEqual({ live: [10], recoverable: [20, 30] });
        const d = claimDecision({
            issue: 40,
            live: census.live,
            cap: 3,
            noCap: false,
            recoverable: census.recoverable,
        });
        expect(d.admitted).toBe(true);
    });

    it("refuses when one of the three classifies UNKNOWN — uncertainty never authorises more concurrency", () => {
        // `unknown` is the absence of a verdict: the probe could not answer,
        // `git ls-remote` could not reach the network, the journal is missing.
        // It is the mirror of `ClaimFacts.ownerAlive`'s `=== true` asymmetry
        // at the other end of the same pipeline.
        const census = capCensus(
            [10, 20, 30],
            verdicts([
                [10, "live"],
                [20, "live"],
                // #30 deliberately absent — no reading at all.
            ])
        );
        expect(census).toEqual({ live: [10, 20, 30], recoverable: [] });
        const d = claimDecision({
            issue: 40,
            live: census.live,
            cap: 3,
            noCap: false,
            recoverable: census.recoverable,
        });
        expect(d.admitted).toBe(false);
        if (!d.admitted) expect(d.refusal).toBe("cap");
    });

    it("counts `suspect` and `orphan` too — only a PROVED recoverable gives up its slot", () => {
        // `orphan` is `loop:doctor --release`'s to drop, and `suspect` is what
        // a healthy pass looks like before its first push. Neither is evidence
        // that no process is burning CPU.
        expect(
            capCensus(
                [10, 20, 30],
                verdicts([
                    [10, "suspect"],
                    [20, "orphan"],
                    [30, "recoverable"],
                ])
            )
        ).toEqual({ live: [10, 20], recoverable: [30] });
    });

    it("the refusal breaks the count into live / recoverable and names `bun run loop:doctor`", () => {
        const d = claimDecision({
            issue: 40,
            live: [10, 20, 30],
            cap: 3,
            noCap: false,
            recoverable: [50, 60],
        });
        expect(d.admitted).toBe(false);
        if (!d.admitted) {
            expect(d.message).toMatch(/3\/3 live claims/);
            expect(d.message).toMatch(
                /5 claimed, 3 live, 2 recoverable \(not counted\): #50, #60/
            );
            expect(d.message).toMatch(/bun run loop:doctor/);
            expect(d.message).toMatch(/resume or salvage those branches/);
            expect(d.message).toMatch(/--no-cap/);
        }
    });

    it("says nothing about recoverable claims when there are none — the refusal keeps its old shape", () => {
        const d = claimDecision({
            issue: 40,
            live: [10, 20, 30],
            cap: 3,
            noCap: false,
        });
        expect(d.admitted).toBe(false);
        if (!d.admitted) expect(d.message).not.toMatch(/recoverable/);
    });

    it("the classifier really does call a dead pass with committed work `recoverable` — end to end", () => {
        // Not a hand-written verdict map: the SAME `classifyClaims` the verbs
        // import, over the facts of the observed incident. #4117 has a local
        // branch with one unpushed commit and a dead owner; #4306 is the same
        // shape with two; #4400 is a live pass.
        const probe: ProcessProbe = (pid) =>
            pid === 999 ? "Tue Sep 22 09:00:00 2026" : "";
        const classified = classifyClaims(
            [
                { number: 4117, title: "a", updatedAt: "2026-09-22T11:00:00Z" },
                { number: 4306, title: "b", updatedAt: "2026-09-22T11:00:00Z" },
                { number: 4400, title: "c", updatedAt: "2026-09-22T11:00:00Z" },
            ],
            {
                prBranches: new Set<string>(),
                branches: {
                    local: [
                        "fix/issue-4117",
                        "feat/issue-4306",
                        "feat/issue-4400",
                    ],
                    remote: [],
                },
                owners: new Map([
                    [
                        4117,
                        {
                            session: "s1",
                            pid: 111,
                            startedAt: "Tue Sep 22 08:00:00 2026",
                        },
                    ],
                    [
                        4306,
                        {
                            session: "s2",
                            pid: 222,
                            startedAt: "Tue Sep 22 08:30:00 2026",
                        },
                    ],
                    [
                        4400,
                        {
                            session: "s3",
                            pid: 999,
                            startedAt: "Tue Sep 22 09:00:00 2026",
                        },
                    ],
                ]),
                baseRef: "origin/staging",
                now: Date.parse("2026-09-22T12:00:00Z"),
                probe,
                countRunner: (_cmd, args) =>
                    /issue-4117$/.test(args[args.length - 1]) ? "1" : "2",
            }
        );
        const states = new Map(
            classified.map((c) => [c.issue, c.verdict.state])
        );
        expect(states.get(4117)).toBe("recoverable");
        expect(states.get(4306)).toBe("recoverable");
        expect(states.get(4400)).toBe("live");

        // …and the census then hands the cap ONE live claim out of three.
        expect(
            capCensus(
                [4117, 4306, 4400],
                states as Map<number, ClaimVerdictState>
            )
        ).toEqual({
            live: [4400],
            recoverable: [4117, 4306],
        });
    });
});

describe("queue:claim — ONE liveness definition, imported (issue #4384)", () => {
    // The discipline `loop-drain.test.ts:1998` already enforces for staleness:
    // a second spelling of "is this claim alive" in the queue verbs is how the
    // two ends drift, and the behavioural tests above would pass just as
    // happily against a private re-derivation.
    const read = (rel: string) =>
        readFileSync(join(__dirname, "..", rel), "utf8");

    for (const verb of ["queue-claim.ts", "queue-plan.ts"]) {
        it(`${verb} imports the classifier from loop-doctor and re-implements nothing`, () => {
            const source = read(verb);
            expect(source).toMatch(/claimVerdicts/);
            expect(source).toMatch(/from "\.\/loop-doctor"/);
            expect(source).toMatch(/capCensus/);
            // No private opinion on liveness: the facts and the thresholds
            // belong to `loop-doctor.ts` alone.
            expect(source).not.toMatch(/ownerAlive|unpushedCommits/);
            expect(source).not.toMatch(/classifyClaim\s*\(/);
        });
    }

    it("the admission path writes NO release — a recoverable claim keeps its label", () => {
        // Releasing it would orphan the dead pass's commits, and that call is
        // `loop:doctor --release`'s alone (issue #3698). The cap only stops
        // counting it.
        expect(read("queue-claim.ts")).not.toMatch(/--remove-label/);
        expect(read("queue-plan.ts")).not.toMatch(/--remove-label/);
    });
});

describe("queue:claim — the lock serialises two real processes (issue #4375)", () => {
    // Not a mock of the lock: two bun processes race the SAME lock directory,
    // each holding it for a measured interval and logging its [enter, exit].
    // The assertion is that the intervals do not overlap — the property the
    // whole verb exists for. `TOLARIA_GATE_LOCK_ROOT` is the seam gate.ts
    // already documents for tests.
    it("holds: the second holder enters only after the first has exited", async () => {
        const root = mkdtempSync(join(tmpdir(), "claim-lock-"));
        const log = join(root, "log.txt");
        const worker = join(root, "worker.ts");
        writeFileSync(
            worker,
            `
import { mkdirSync, rmSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const dir = join(process.env.TOLARIA_GATE_LOCK_ROOT!, "claim.lock");
const log = process.argv[2]; const tag = process.argv[3];
mkdirSync(process.env.TOLARIA_GATE_LOCK_ROOT!, { recursive: true });
for (;;) {
    try { mkdirSync(dir, { recursive: false }); break; } catch {}
    await new Promise((r) => setTimeout(r, 10));
}
writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: process.pid, ts: Date.now(), label: tag }));
appendFileSync(log, tag + " enter " + Date.now() + "\\n");
await new Promise((r) => setTimeout(r, 300));
appendFileSync(log, tag + " exit " + Date.now() + "\\n");
rmSync(dir, { recursive: true, force: true });
`
        );
        const run = (tag: string) =>
            new Promise<number>((resolve) => {
                const p = spawn("bun", [worker, log, tag], {
                    env: { ...process.env, TOLARIA_GATE_LOCK_ROOT: root },
                    stdio: "ignore",
                });
                const t = setTimeout(() => p.kill("SIGKILL"), 15_000);
                p.on("exit", (code) => {
                    clearTimeout(t);
                    resolve(code ?? -1);
                });
            });
        try {
            const codes = await Promise.all([run("A"), run("B")]);
            expect(codes).toEqual([0, 0]);
            const lines = readFileSync(log, "utf8").trim().split("\n");
            const at = (tag: string, ev: string) =>
                Number(
                    lines
                        .find((l) => l.startsWith(`${tag} ${ev}`))!
                        .split(" ")[2]
                );
            const first = at("A", "enter") < at("B", "enter") ? "A" : "B";
            const second = first === "A" ? "B" : "A";
            expect(at(second, "enter")).toBeGreaterThanOrEqual(
                at(first, "exit")
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 30_000);
});
