#!/usr/bin/env bun
// `bun run queue:claim <N> [--no-cap]` — claim issue N as ONE locked act
// (issue #4375, PRD #4373; the decision and the row are `lib/queue-claim.ts`).
//
// Under the claim lock, in this order:
//   1. read the live claims the way the planner does (`in-progress` labels
//      minus the journal's released rows minus the stale ones);
//   2. decide — a collision refuses outright, the cap refuses unless --no-cap;
//   3. `gh issue edit N --add-label in-progress --add-assignee @me`;
//   4. append the journal row `claim-ledger.sh` would have written.
// Then release the lock. Exit 0 on a claim, 1 on a refusal (the message names
// the way out), 2 on a usage error.
//
// `queue:plan` stays read-only. `deny-guard.sh` § 5 counts planner runs
// (MAX_PASSES = 1) — this verb is not one and must never be matched by that
// rule; § 6 denies the hand-typed claim and names this verb as the exit.

import {
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { gh } from "./lib/gh";
import { sessionCap } from "./lib/branches";
import { primaryCheckout } from "./lib/primary-checkout";
import { claimLedgerPath, interpretPsResult } from "./loop-doctor";
import { isStaleClaim, releasedClaims } from "./lib/queue-plan";
import { DEFAULTS } from "./queue-plan";
import {
    buildClaimRow,
    claimDecision,
    claimLockVerdict,
    latestPlanFor,
    liveClaimSet,
    parsePpidComm,
    type ClaimLockOwner,
    type ClaimRowOwner,
} from "./lib/queue-claim";

// ── lock ─────────────────────────────────────────────────────────────────────
// Same root as the gate's mutex (`scripts/gate.ts` LOCK_ROOT) so the two are
// found together by `gate:who`-style inspection, its own directory so a claim
// never queues behind a heavy gate. Env override is the tests' seam.
const LOCK_ROOT =
    process.env.TOLARIA_GATE_LOCK_ROOT ?? join(homedir(), ".cache", "tolaria");
const LOCK_DIR = join(LOCK_ROOT, "claim.lock");
const OWNER_FILE = join(LOCK_DIR, "owner.json");
/** A claim is two `gh` calls; a holder past this is hung. */
const STALE_MS = Number(process.env.TOLARIA_CLAIM_LOCK_STALE_MS ?? 30_000);
/** Bounded wait: a waiter that never gives up is the hang it was meant to avoid. */
const WAIT_MS = Number(process.env.TOLARIA_CLAIM_LOCK_WAIT_MS ?? 60_000);
const POLL_MS = 150;

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function readOwner(): ClaimLockOwner | null {
    try {
        return JSON.parse(readFileSync(OWNER_FILE, "utf8")) as ClaimLockOwner;
    } catch {
        return null;
    }
}

function tryTake(label: string): boolean {
    try {
        mkdirSync(LOCK_DIR, { recursive: false });
    } catch {
        return false;
    }
    const owner: ClaimLockOwner = { pid: process.pid, ts: Date.now(), label };
    writeFileSync(OWNER_FILE, JSON.stringify(owner));
    return true;
}

function releaseLock(): void {
    try {
        rmSync(LOCK_DIR, { recursive: true, force: true });
    } catch {
        /* another waiter reclaimed it — nothing to do */
    }
}

async function withClaimLock<T>(label: string, fn: () => T): Promise<T> {
    mkdirSync(LOCK_ROOT, { recursive: true });
    const t0 = Date.now();
    for (;;) {
        if (tryTake(label)) break;
        const owner = readOwner();
        const now = Date.now();
        const verdict = claimLockVerdict(
            owner,
            now,
            STALE_MS,
            owner !== null && alive(owner.pid)
        );
        if (verdict !== "wait") {
            console.error(
                `queue:claim: reclaiming the claim lock — ${verdict === "reclaim-dead" ? "holder is gone" : "holder is hung"} (pid ${owner?.pid}, ${owner?.label})`
            );
            releaseLock();
            continue;
        }
        if (now - t0 > WAIT_MS) {
            throw new Error(
                `claim lock held for ${Math.round((now - t0) / 1000)}s by pid ${owner?.pid ?? "?"} (${owner?.label ?? "unreadable owner"}) — ` +
                    `a claim is two gh calls; if that process is gone, remove ${LOCK_DIR} and retry`
            );
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
    try {
        return fn();
    } finally {
        releaseLock();
    }
}

// ── reads ────────────────────────────────────────────────────────────────────

function claimedIssues(): { number: number; updatedAt: string }[] {
    return JSON.parse(
        gh([
            "issue",
            "list",
            "--state",
            "open",
            "--label",
            "in-progress",
            "--limit",
            "500",
            "--json",
            "number,updatedAt",
        ])
    ) as { number: number; updatedAt: string }[];
}

function issuesWithOpenPr(): number[] {
    const prs = JSON.parse(
        gh([
            "pr",
            "list",
            "--state",
            "open",
            "--limit",
            "200",
            "--json",
            "headRefName",
        ])
    ) as { headRefName: string }[];
    return prs
        .map((p) => /issue-(\d+)$/.exec(p.headRefName)?.[1])
        .filter((n): n is string => n !== undefined)
        .map(Number);
}

function projectRoot(): string {
    return process.env.CLAUDE_PROJECT_DIR ?? primaryCheckout();
}

function releasedOnThisMachine(root: string): number[] {
    try {
        return releasedClaims(readFileSync(claimLedgerPath(root), "utf8"));
    } catch {
        return [];
    }
}

// ── owner stamp (issue #2627), the hook's walk in TypeScript ────────────────
// Nearest ancestor whose command basename is `claude`; `TOLARIA_CLAIM_OWNER_COMM`
// is the tests' seam, as in `claim-ledger.sh`. Best-effort: `null` reads
// downstream as "unknown", which changes no verdict.
function ownerStamp(): ClaimRowOwner | null {
    const want = process.env.TOLARIA_CLAIM_OWNER_COMM ?? "claude";
    let pid = process.pid;
    for (let depth = 0; depth < 16; depth++) {
        const r = spawnSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], {
            encoding: "utf8",
        });
        if (r.status !== 0) return null;
        const parsed = parsePpidComm(r.stdout ?? "");
        if (!parsed) return null;
        if (parsed.comm === want) {
            const started = interpretPsResult(
                spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
                    encoding: "utf8",
                    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
                })
            );
            return started ? { pid, startedAt: started } : null;
        }
        if (parsed.ppid <= 1) return null;
        pid = parsed.ppid;
    }
    return null;
}

// ── journal ──────────────────────────────────────────────────────────────────

function appendJournalRow(root: string, issue: number, session: string): void {
    const plansDir = join(root, ".claude", "telemetry", "plans");
    let names: string[] = [];
    try {
        names = readdirSync(plansDir);
    } catch {
        /* no plans yet */
    }
    const planId = latestPlanFor(session, names);
    let planned: number[] | null = null;
    if (planId !== null) {
        try {
            const record = JSON.parse(
                readFileSync(join(plansDir, planId), "utf8")
            ) as { plan?: { batch?: { number: number }[] } };
            planned = (record.plan?.batch ?? []).map((b) => b.number);
        } catch {
            planned = [];
        }
    }
    const row = buildClaimRow({
        now: Math.floor(Date.now() / 1000),
        session,
        issue,
        planId,
        planned,
        owner: ownerStamp(),
    });
    if (row.planMismatch)
        console.error(
            `queue-plan mismatch: claimed #${issue} is not in session ${session}'s latest plan (${planId}) — plan admitted ${JSON.stringify(planned)}`
        );
    else if (planId === null && session !== "")
        console.error(
            `queue-plan mismatch: claimed #${issue} with no preceding plan for session ${session}`
        );
    const dir = join(root, ".claude", "telemetry");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "claims.jsonl"), JSON.stringify(row) + "\n", {
        flag: "a",
    });
}

// ── main ─────────────────────────────────────────────────────────────────────

function usage(): never {
    console.error("usage: bun run queue:claim <issue#> [--no-cap]");
    process.exit(2);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const numbers = args.filter((a) => /^#?\d+$/.test(a));
    if (numbers.length !== 1) usage();
    const issue = Number(numbers[0].replace(/^#/, ""));
    const noCap = args.includes("--no-cap");
    const root = projectRoot();
    const session = process.env.CLAUDE_CODE_SESSION_ID ?? "";

    const outcome = await withClaimLock(`claim #${issue}`, () => {
        const now = new Date().toISOString();
        const live = liveClaimSet(
            claimedIssues(),
            issuesWithOpenPr(),
            releasedOnThisMachine(root),
            now,
            DEFAULTS.staleClaimHours,
            isStaleClaim
        );
        const decision = claimDecision({
            issue,
            live,
            cap: sessionCap(),
            noCap,
        });
        if (!decision.admitted) return decision;
        gh([
            "issue",
            "edit",
            String(issue),
            "--add-label",
            "in-progress",
            "--add-assignee",
            "@me",
        ]);
        appendJournalRow(root, issue, session);
        return { admitted: true as const, live };
    });

    if (!outcome.admitted) {
        console.error(`✗ ${outcome.message}`);
        process.exit(1);
    }
    const cap = sessionCap();
    console.log(
        `queue:claim: claimed issue #${issue} (${outcome.live.length + 1}/${cap} live claims${noCap && outcome.live.length >= cap ? ", past the cap by --no-cap" : ""})`
    );
}

if (import.meta.main) {
    main().catch((err) => {
        console.error(`✗ queue:claim: ${(err as Error).message}`);
        process.exit(1);
    });
}
