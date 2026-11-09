// `bun run bug-report:pull <rowId>` — the pure half (issue #9005, PRD issue
// #8998). A `bugReports` row carries the EXPANDED `GameState` frozen at the
// report (user button or system Bot fault); this lowers it to a
// `ScenarioSpec` through the one existing inverse, `specFromState`, so an
// agent picking a Bot-fault issue starts from the exact position rather than
// from a board summary. Every decision is a function here; the CLI around it
// (`scripts/bug-report-pull.ts`) is a `convex run` and a print.
//
// Lossy by construction, and SAYS so: `dropped[]` and `stackBlockers[]` are
// `specFromState`'s own report of what the spec could not carry, printed
// beside the spec — never filtered.

import {
    specFromState,
    type StackBlocker,
} from "../../convex/gre/scenarioBuilder";
import type { GameState } from "../../convex/gre/state";
import type { ScenarioSpec } from "../../convex/debugScenarioSpec";
import { convexRunArgv } from "./seed-scenario-run";

/** The `getReport` fields this command reads — the internal query returns
 *  more (contact columns among them), none of which is printed. */
export type PulledBugReportRow = {
    source?: "user" | "system";
    gameId?: string;
    seq?: number;
    state?: unknown;
    clientDiagnostics?: unknown;
    fault?: { expectedKind: string; faultClass: string; origin: string };
};

export type PullArgs = {
    reportId: string;
    out?: string;
    seat?: string;
    prod: boolean;
};

export const PULL_USAGE =
    "usage: bun run bug-report:pull <reportId> [--out <file>] [--seat <playerId>] [--prod]";

/** argv → args; throws the usage line on anything it cannot read. */
export function parsePullArgs(argv: string[]): PullArgs {
    let out: string | undefined;
    let seat: string | undefined;
    let prod = false;
    const positional: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--prod") prod = true;
        else if (a === "--out" || a === "--seat") {
            const value = argv[++i];
            if (!value || value.startsWith("--")) throw new Error(PULL_USAGE);
            if (a === "--out") out = value;
            else seat = value;
        } else if (a.startsWith("--")) throw new Error(PULL_USAGE);
        else positional.push(a);
    }
    if (positional.length !== 1) throw new Error(PULL_USAGE);
    return { reportId: positional[0], out, seat, prod };
}

/** The `npx` argv reading one row. `getReport` is an `internalQuery`: the CLI
 *  reaches it with no identity, and it has existed for many releases, so no
 *  `--push`. `--prod` sits right after `run` (a `convex run` flag). */
export function pullArgv(args: Pick<PullArgs, "reportId" | "prod">): string[] {
    const argv = convexRunArgv(
        "bugReports:getReport",
        JSON.stringify({ reportId: args.reportId }),
        { push: false }
    );
    if (args.prod) argv.splice(2, 0, "--prod");
    return argv;
}

/**
 * Which live seat becomes `"me"`. An explicit `--seat` wins. Otherwise the
 * seat model every solo / vs-AI game shares (`convex/game.ts`,
 * `createSoloGame`): the caller drives `${userId}-p1`, the Bot `-p2` — so the
 * human is `"me"` and the Bot is `"opp"`, the frame debug scenarios are
 * authored in. A two-user game has no such suffix: `players[0]`.
 */
export function defaultSeat(state: GameState, seat?: string): string {
    if (seat !== undefined) return seat;
    const p1 = state.players.find((p) => p.id.endsWith("-p1"));
    return (p1 ?? state.players[0]).id;
}

/** A one-line-per-fact summary of the row's `clientDiagnostics`, read
 *  STRUCTURALLY (the shape is `v.any()` on the row and lives in `src/`, which
 *  a script must not import): which build, how deep each ring is. The full
 *  object stays on the row — `getReport` prints it whole. */
export function summarizeClientDiagnostics(diagnostics: unknown): string[] {
    if (diagnostics === undefined || diagnostics === null) return ["none"];
    if (typeof diagnostics !== "object")
        return [`unreadable (${typeof diagnostics})`];
    const d = diagnostics as Record<string, unknown>;
    const lines: string[] = [];
    const build = d.build as Record<string, unknown> | undefined;
    if (build && typeof build === "object") {
        const facts = Object.entries(build)
            .filter(
                ([, v]) =>
                    typeof v === "string" ||
                    typeof v === "number" ||
                    typeof v === "boolean"
            )
            .map(([k, v]) => `${k}=${String(v)}`);
        lines.push(`build: ${facts.join(" ") || "present"}`);
    }
    const ai = d.ai as Record<string, unknown> | undefined;
    if (ai && typeof ai === "object") {
        const rings = Object.entries(ai).map(([k, v]) =>
            Array.isArray(v) ? `${k}[${v.length}]` : k
        );
        lines.push(`ai: ${rings.join(" ")}`);
    }
    for (const key of ["console", "failedRequests"] as const) {
        const ring = d[key];
        if (Array.isArray(ring)) lines.push(`${key}: ${ring.length} entries`);
    }
    const connection = d.connection as Record<string, unknown> | undefined;
    if (connection && typeof connection === "object") {
        lines.push(
            `connection: ${Object.entries(connection)
                .map(([k, v]) => `${k}=${String(v)}`)
                .join(" ")}`
        );
    }
    const named = new Set([
        "build",
        "ai",
        "console",
        "failedRequests",
        "connection",
    ]);
    const rest = Object.keys(d)
        .filter((k) => !named.has(k))
        .sort();
    if (rest.length > 0) lines.push(`also: ${rest.join(" ")}`);
    return lines.length > 0 ? lines : ["empty"];
}

export type PullResult =
    | {
          ok: true;
          reportId: string;
          source: "user" | "system";
          gameId?: string;
          seq?: number;
          /** The live player id that became `"me"`. */
          mySeatId: string;
          fault?: PulledBugReportRow["fault"];
          spec: ScenarioSpec;
          dropped: string[];
          stackBlockers: StackBlocker[];
          clientDiagnostics: string[];
      }
    | { ok: false; message: string };

/** The whole lowering of one row. Never throws: every refusal is a message
 *  the CLI prints and exits non-zero on. */
export function lowerBugReportRow(
    reportId: string,
    row: PulledBugReportRow | null,
    opts: { seat?: string } = {}
): PullResult {
    if (row === null)
        return { ok: false, message: `bug report ${reportId}: no such row` };
    const source = row.source ?? "user";
    const state = row.state as GameState | undefined;
    if (state === undefined || state === null) {
        return {
            ok: false,
            message: `bug report ${reportId} (${source}) carries no game state — it was filed outside a game${source === "user" ? " or the reporter declined diagnostics" : ""}; nothing to lower`,
        };
    }
    if (!Array.isArray(state.players) || state.players.length !== 2) {
        return {
            ok: false,
            message: `bug report ${reportId}: frozen state has no two-player \`players[]\` — not a GameState this command can lower`,
        };
    }
    const mySeatId = defaultSeat(state, opts.seat);
    try {
        const lowered = specFromState(state, { mySeatId });
        return {
            ok: true,
            reportId,
            source,
            gameId: row.gameId,
            seq: row.seq,
            mySeatId,
            fault: row.fault,
            spec: lowered.spec,
            dropped: lowered.dropped,
            stackBlockers: lowered.stackBlockers,
            clientDiagnostics: summarizeClientDiagnostics(
                row.clientDiagnostics
            ),
        };
    } catch (e) {
        return {
            ok: false,
            message: `bug report ${reportId}: specFromState refused the state — ${e instanceof Error ? e.message : String(e)}`,
        };
    }
}

/** What `--out` writes: the `{ label, spec }` shape a `## Preset scenario`
 *  fence and the debug-scenario panel both take, so the file seeds as-is. */
export function scenarioFile(result: Extract<PullResult, { ok: true }>): {
    label: string;
    spec: ScenarioSpec;
} {
    const what = result.fault
        ? `${result.fault.faultClass} at ${result.fault.expectedKind}`
        : "user report";
    return {
        label: `Bug report ${result.reportId} — ${what}`,
        spec: result.spec,
    };
}
