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
// No session is refused at its prompt (issue #5137): a conversation adds no
// load. Heavy gates wait on the machine; `queue:claim` and `wt:new` take the
// session decision (`lib/machine-admission.ts`).

import { spawn, spawnSync } from "node:child_process";
import { cpus, totalmem } from "node:os";
import {
    admitSessionNow,
    consumerLines,
    memorySaturation,
    parseProcRows,
    readConsumers,
    readMachineSample,
    readSessionCensus,
    sampleLine,
    saturation,
    sessionLine,
    subtreeRssMb,
} from "./lib/machine-admission";

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
    // Who holds it (issue #4989) — the same lines a gate's busy wait prints,
    // and only when a threshold reads over: a calm report probes nothing.
    if (busy.length > 0) {
        const t3 = performance.now();
        const top = readConsumers();
        console.log(
            `  top consumers    (probe ${(performance.now() - t3).toFixed(0)} ms)`
        );
        for (const line of consumerLines(top)) console.log(`  ${line}`);
    }
    console.log(
        `  a claim/worktree ${now.decision.verdict === "admit" ? "is admitted" : `is REFUSED — ${now.decision.reasons.join("; ")}`}${census?.self != null ? " (counted from this session: the others)" : ""}`
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
            timeout: 5000,
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
    process.exit(verb === "measure" ? await measure(args) : report());
}
