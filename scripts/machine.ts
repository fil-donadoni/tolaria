#!/usr/bin/env bun
// `bun run machine` — what the machine admission sees (issue #4966): the
// probes, the thresholds they are held against, the effective session cap and
// who is using it. Informational: always exits 0.
//
// `bun run machine measure <command…>` runs the command and prints the peak
// resident memory of its process tree — the measurement
// `machine.sessionBudgetMb` is derived from
// (`docs/agents/quality-gates.md` § Machine admission).
//
// `bun scripts/machine.ts admit-session <session-id>` is the verb
// `.claude/hooks/session-admission.sh` calls on a session's first prompt:
// exit 0 admits (and stamps the session, so later prompts are not asked),
// exit 2 refuses with the reason on stderr. The decision is
// `lib/machine-admission.ts`'s, the same one `queue:claim` and `wt:new` take.

import {
    mkdirSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { cpus, homedir, totalmem } from "node:os";
import { join } from "node:path";
import {
    OVER_CAP_ENV,
    admitSessionNow,
    logSessionAdmission,
    memorySaturation,
    parseProcRows,
    readMachineSample,
    readSessionCensus,
    sampleLine,
    saturation,
    sessionLine,
    sessionRefusal,
    subtreeRssMb,
} from "./lib/machine-admission";

/** Where an admitted session is stamped — beside the gate's locks, outside
 *  the repo, so every worktree's hook reads the same stamps. */
function stampDir(): string {
    return join(
        process.env.TOLARIA_GATE_LOCK_ROOT ??
            join(homedir(), ".cache", "tolaria"),
        "sessions"
    );
}

/** A stamp outlives its session by design (the hook only ever reads its own);
 *  a week is far past any session, and keeps the directory from growing. */
const STAMP_TTL_MS = 7 * 24 * 3600 * 1000;

function stampSession(session: string): void {
    const dir = stampDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, session), `${Date.now()}\n`);
    for (const name of readdirSync(dir)) {
        try {
            if (Date.now() - statSync(join(dir, name)).mtimeMs > STAMP_TTL_MS)
                rmSync(join(dir, name), { force: true });
        } catch {
            /* raced with another session's sweep */
        }
    }
}

function admitSession(session: string): number {
    if (!/^[A-Za-z0-9_-]+$/.test(session)) {
        console.error(
            "usage: bun scripts/machine.ts admit-session <session-id>"
        );
        return 1;
    }
    const now = admitSessionNow({
        override: process.env[OVER_CAP_ENV] === "1",
    });
    logSessionAdmission(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), now, {
        source: "session",
        session,
    });
    const others = now.census?.others ?? [];
    if (now.decision.verdict === "refuse") {
        console.error(sessionRefusal(now.decision.reasons, others));
        return 2;
    }
    // A UserPromptSubmit hook's stdout is added to the session's context:
    // the one thing worth saying there is that this session runs past the
    // cap, on whose word.
    if (now.decision.overridden.length > 0)
        console.log(
            `machine admission OVERRIDDEN by ${OVER_CAP_ENV}=1 — ${now.decision.overridden.join("; ")}. This session runs past what the machine was measured to carry; the override is logged.`
        );
    stampSession(session);
    return 0;
}

function report(): number {
    const t0 = performance.now();
    const sample = readMachineSample();
    const t1 = performance.now();
    const census = readSessionCensus();
    const t2 = performance.now();
    const now = admitSessionNow({ override: false });
    const t = now.thresholds;
    const mark = (over: boolean) => (over ? "OVER" : "ok");
    const mbOr = (n: number | null) =>
        n === null ? "unread" : `${Math.round(n)} MB`;

    console.log(
        `machine — ${cpus().length} cores, ${(totalmem() / 1024 ** 3).toFixed(0)} GB (probes: sample ${(t1 - t0).toFixed(0)} ms, session census ${(t2 - t1).toFixed(0)} ms)`
    );
    console.log(
        `  load (1 min)     ${sample.load1.toFixed(1)}  ·  max ${t.loadMax}  ·  ${mark(sample.load1 > t.loadMax)}`
    );
    console.log(
        `  memory pressure  ${sample.pressure === null ? "unread" : `kernel level ${sample.pressure}`}  ·  max 1 (normal)  ·  ${mark(memorySaturation(sample).length > 0)}`
    );
    console.log(
        `  swap used        ${mbOr(sample.swapUsedMb)}  ·  recorded, not a threshold (a high-water mark)`
    );
    console.log(
        `  reclaimable RAM  ${mbOr(sample.reclaimableMb)} (free + inactive)  ·  ${t.sessionBudgetMb} MB per session`
    );
    if (census === null) {
        console.log(
            "  sessions         unread (ps / lsof / git failed) — admission counts none"
        );
    } else {
        console.log(
            `  sessions         ${census.all.length} live  ·  cap ${now.cap}  ·  effective cap ${now.decision.effectiveCap}`
        );
        // A session another session spawned is its own row, not part of
        // its parent's tree.
        const pids = new Set(census.all.map((s) => s.pid));
        for (const s of census.all)
            console.log(
                `    ${sessionLine(s)} · ${Math.round(subtreeRssMb(census.rows, s.pid, pids))} MB${s.pid === census.self ? "  ← this session" : ""}`
            );
    }
    const busy = saturation(sample, t);
    console.log(
        `  a gate start     ${busy.length === 0 ? "is admitted" : `WAITS up to ${t.waitMaxS}s — ${busy.join("; ")}`} (${sampleLine(sample)})`
    );
    console.log(
        `  a new session    ${now.decision.verdict === "admit" ? "is admitted" : `is REFUSED — ${now.decision.reasons.join("; ")}`}${census?.self != null ? " (counted from this session: the others)" : ""}`
    );
    return 0;
}

/** Run `argv`, sampling the resident memory of its whole tree four times a
 *  second; print the peak. */
async function measure(argv: string[]): Promise<number> {
    if (argv.length === 0) {
        console.error("usage: bun run machine measure <command…>");
        return 2;
    }
    const child = spawn(argv[0], argv.slice(1), { stdio: "inherit" });
    let peakMb = 0;
    let samples = 0;
    const timer = setInterval(() => {
        const ps = spawnSync("ps", ["-axo", "pid=,ppid=,etime=,rss=,comm="], {
            encoding: "utf8",
        });
        if (ps.status !== 0 || child.pid === undefined) return;
        peakMb = Math.max(
            peakMb,
            subtreeRssMb(parseProcRows(ps.stdout), child.pid)
        );
        samples++;
    }, 250);
    const code = await new Promise<number>((resolve) =>
        child.on("exit", (c) => resolve(c ?? 1))
    );
    clearInterval(timer);
    console.log(
        `machine measure: peak ${Math.round(peakMb)} MB resident across the process tree (${samples} samples, exit ${code}) — ${argv.join(" ")}`
    );
    return code;
}

if (import.meta.main) {
    const [, , verb, ...args] = process.argv;
    process.exit(
        verb === "admit-session"
            ? admitSession(args[0] ?? "")
            : verb === "measure"
              ? await measure(args)
              : report()
    );
}
