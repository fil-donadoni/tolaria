#!/usr/bin/env bun
// `bun run bug-report:pull <reportId> [--out <file>] [--seat <playerId>] [--prod]`
// (issue #9005, PRD issue #8998) — lower a `bugReports` row's frozen game
// state to a `ScenarioSpec` and print it with everything the lowering could
// not carry (`dropped[]`, `stackBlockers[]`) and a summary of the client
// diagnostics. A system-filed Bot-fault issue names this command with its row
// id (`buildBotFaultIssueRequest`, `convex/botFaultReport.ts`).
//
// Thin plumbing: every decision is in `scripts/lib/bug-report-pull.ts`. It
// calls the internal `bugReports:getReport` from the PRIMARY CHECKOUT, where
// the deployment state lives (`primaryCheckout()`); `--prod` reads the
// production deployment instead of the local one.
//
// Exit 0 = lowered; 1 = no row, no state, a refusal or a `convex run` failure;
// 2 = usage.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { convexRunErrorMessage } from "./lib/convex-run-error";
import { primaryCheckout } from "./lib/primary-checkout";
import {
    lowerBugReportRow,
    parsePullArgs,
    pullArgv,
    scenarioFile,
    type PullArgs,
    type PulledBugReportRow,
} from "./lib/bug-report-pull";

const CALL_TIMEOUT_MS = 60_000;

function fetchRow(args: PullArgs): PulledBugReportRow | null {
    const res = spawnSync("npx", pullArgv(args), {
        cwd: primaryCheckout(),
        encoding: "utf8",
        timeout: CALL_TIMEOUT_MS,
        // A frozen state with a long decision log is megabytes of JSON.
        maxBuffer: 256 * 1024 * 1024,
    });
    if (res.error) throw new Error(res.error.message);
    if (res.status !== 0) {
        throw new Error(
            convexRunErrorMessage(
                `${res.stderr ?? ""}${res.stdout ?? ""}`.trim()
            )
        );
    }
    const out = (res.stdout ?? "").trim();
    return out === "" || out === "null"
        ? null
        : (JSON.parse(out) as PulledBugReportRow);
}

function main(): number {
    let args: PullArgs;
    try {
        args = parsePullArgs(process.argv.slice(2));
    } catch (e) {
        console.error((e as Error).message);
        return 2;
    }
    let row: PulledBugReportRow | null;
    try {
        row = fetchRow(args);
    } catch (e) {
        console.error(`bug-report:pull: ${(e as Error).message}`);
        return 1;
    }
    const result = lowerBugReportRow(args.reportId, row, { seat: args.seat });
    if (!result.ok) {
        console.error(`bug-report:pull: ${result.message}`);
        return 1;
    }
    console.log(JSON.stringify(result, null, 2));
    if (args.out) {
        const path = resolve(args.out);
        writeFileSync(
            path,
            `${JSON.stringify(scenarioFile(result), null, 4)}\n`
        );
        console.error(`bug-report:pull: wrote { label, spec } to ${path}`);
    }
    console.error(
        `bug-report:pull: ${result.dropped.length} dropped, ${result.stackBlockers.length} stack blocker(s) — the spec is the position MINUS those`
    );
    return 0;
}

process.exit(main());
