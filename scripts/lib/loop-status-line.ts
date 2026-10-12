// The AFK terminal's live status line (issue #4722, PRD #4717): ONE row per
// pass in flight at the bottom of the rendered view, saying what each is
// doing — a multi-lane run (issue #5486) has several at once (issue #5546).
//
// It is a VIEW of the moment, never a record: the wrapper
// (`scripts/loop-render.ts`) draws it only on a TTY, erases it before every
// real line and redraws it after, and it never reaches `loop-afk.log` — the
// renderer sits after `tee` (`scripts/loop-handoff.sh`), and this line is
// not even a log line to begin with.
//
//   level A  spinner · pass · [lane] · issue · tier · elapsed · [run spend]
//   level B  … · last tool + target · active subagents · pass tokens
//
// The run's spend is the run's, not a pass's: drawn once, on the first row.
//
// Level A comes from the driver's own tags alone; level B from the pass's
// transcript (`scripts/lib/pass-activity.ts`), which the pass-start tag's
// `session=<uuid>` binds exactly. No transcript → level A, never a guess.
//
// Pure: state in, state out; the clock and the transcript read are the
// caller's, passed in.

import {
    classifyLine,
    formatDuration,
    formatTokens,
    paint,
    parseFields,
    splitPassSession,
    stripStamp,
    visibleLength,
    type RenderEnv,
} from "./loop-render";
import type { PassActivity } from "./pass-activity";

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Longest tool target the line carries before the whole line is fitted. */
export const TOOL_TARGET_MAX = 48;

export interface PassInFlight {
    pass: string;
    /** The lane the pass runs in — null on a one-lane run (no `— lane K`). */
    lane: string | null;
    /** `#N · tier`, or the override prompt — whatever the start tag named. */
    label: string;
    session: string | null;
    startMs: number;
}

export interface StatusLineState {
    /** Every pass in flight, in start order; one per lane. */
    inFlight: PassInFlight[];
    /** The run's spend as of the last pass-END tag, and what it is drawn
     *  against (the effective ceiling, else the budget). */
    spent: number | null;
    ceiling: number | null;
}

export const INITIAL_STATUS_LINE_STATE: StatusLineState = {
    inFlight: [],
    spent: null,
    ceiling: null,
};

const num = (v: string | undefined): number | null =>
    v !== undefined && /^\d+(\.\d+)?$/.test(v) ? Number(v) : null;

/** Fold one stamped log line into the status state. Only tags move it. */
export function observeStatusLine(
    state: StatusLineState,
    line: string,
    nowMs: number
): StatusLineState {
    const cls = classifyLine(stripStamp(line));
    if (cls.kind !== "tagged") return state;
    if (cls.tag === "pass") {
        const { message, session } = splitPassSession(cls.message);
        // `— lane K` only on a multi-lane run (issue #5486).
        const m =
            /^pass (\d+)(?: — lane (\d+))? — issue #(\d+) on tier (\S+?)\.?$/.exec(
                message
            );
        const p = /^pass (\d+)(?: — lane (\d+))? — (.*?)\.?$/.exec(message);
        const pass: PassInFlight = {
            pass: m?.[1] ?? p?.[1] ?? "?",
            lane: m?.[2] ?? p?.[2] ?? null,
            label: m ? `#${m[3]} · ${m[4]}` : (p?.[3] ?? message),
            session,
            startMs: nowMs,
        };
        // A pass number is never reused, nor a lane while its pass runs:
        // either matching means the earlier row's END was lost — replace it.
        const others = state.inFlight.filter(
            (q) =>
                q.pass !== pass.pass &&
                (pass.lane === null || q.lane !== pass.lane)
        );
        return { ...state, inFlight: [...others, pass] };
    }
    if (cls.tag === "end") {
        const f = parseFields(cls.message);
        return {
            // The END names its pass: only that row goes, the other lanes
            // keep running. No `pass=` at all → nothing left to trust.
            inFlight:
                f.pass === undefined
                    ? []
                    : state.inFlight.filter((q) => q.pass !== f.pass),
            spent: num(f.spent) ?? state.spent,
            ceiling: num(f.ceiling) ?? num(f.budget) ?? state.ceiling,
        };
    }
    if (cls.tag === "summary") return { ...state, inFlight: [] };
    return state;
}

/** One line, at most `max` characters: a multi-line Bash command would
 *  otherwise break the line it is drawn on. */
const clip = (s: string, max: number): string => {
    const flat = s.replace(/\s+/g, " ").trim();
    const chars = [...flat];
    return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : flat;
};

/** Cut a painted line to `max` visible columns (escapes cost nothing). */
function fitWidth(line: string, max: number): string {
    if (visibleLength(line) <= max) return line;
    let out = "";
    let seen = 0;
    // eslint-disable-next-line no-control-regex
    for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
        if (part.startsWith("\x1b[")) {
            out += part;
            continue;
        }
        for (const ch of part) {
            if (seen >= max - 1) return `${out}…\x1b[0m`;
            out += ch;
            seen++;
        }
    }
    return out;
}

/** Rows in lane order; passes without a lane keep their start order. */
function byLane(passes: PassInFlight[]): PassInFlight[] {
    return passes
        .map((q, i) => ({ q, i }))
        .sort(
            (a, b) =>
                Number(a.q.lane ?? Infinity) - Number(b.q.lane ?? Infinity) ||
                a.i - b.i
        )
        .map(({ q }) => q);
}

/**
 * The status rows for `state` at `nowMs`: one per pass in flight, empty when
 * none is (between passes, after the summary) — then nothing is drawn.
 * `activityOf(session)` null is level A for that row. No row ever exceeds
 * `env.width - 1` columns: a row that wraps cannot be erased by row count.
 */
export function formatStatusLines(
    state: StatusLineState,
    activityOf: (session: string | null) => PassActivity | null,
    nowMs: number,
    frame: number,
    env: RenderEnv
): string[] {
    const run =
        state.spent === null
            ? "run spend n/a"
            : state.ceiling
              ? `run ${formatTokens(state.spent)}/${formatTokens(state.ceiling)}`
              : `run ${formatTokens(state.spent)}`;
    return byLane(state.inFlight).map((cur, row) => {
        const parts = [
            paint(env, "cyan", SPINNER[frame % SPINNER.length]),
            paint(env, "bold", `pass ${cur.pass}`),
        ];
        if (cur.lane !== null)
            parts.push(paint(env, "bold", `lane ${cur.lane}`));
        parts.push(cur.label, formatDuration((nowMs - cur.startMs) / 1000));
        if (row === 0) parts.push(run);
        const activity = activityOf(cur.session);
        if (activity) {
            const tool = activity.lastTool;
            parts.push(
                tool
                    ? `${tool.name}${tool.target ? ` ${clip(tool.target, TOOL_TARGET_MAX)}` : ""}`
                    : "no tool yet",
                `${activity.activeSubagents} subagent${activity.activeSubagents === 1 ? "" : "s"}`,
                `pass ${formatTokens(activity.tokens)}`
            );
        }
        return fitWidth(
            parts.join(paint(env, "dim", " · ")),
            Math.max(1, env.width - 1)
        );
    });
}
