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
    parsePpidComm,
} from "../lib/queue-claim";
import { isStaleClaim } from "../lib/queue-plan";

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

describe("queue:claim — the live set is the planner's (issue #4375)", () => {
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

    it("reclaims a live holder past the stale window — a claim is two gh calls", () => {
        expect(claimLockVerdict(owner, 1_031_000, 30_000, true)).toBe(
            "reclaim-stale"
        );
    });

    it("WAITS on an unreadable owner file — it is a lock mid-write, and reclaiming it would race the holder", () => {
        expect(claimLockVerdict(null, 1_031_000, 30_000, false)).toBe("wait");
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
