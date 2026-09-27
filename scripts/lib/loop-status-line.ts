// The AFK terminal's live status line (issue #4722, PRD #4717): ONE line at
// the bottom of the rendered view saying what the pass in flight is doing.
//
// It is a VIEW of the moment, never a record: the wrapper
// (`scripts/loop-render.ts`) draws it only on a TTY, erases it before every
// real line and redraws it after, and it never reaches `loop-afk.log` — the
// renderer sits after `tee` (`scripts/loop-handoff.sh`), and this line is
// not even a log line to begin with.
//
//   level A  spinner · pass · issue · tier · elapsed · run spend
//   level B  … · last tool + target · active subagents · pass tokens
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
    /** `#N · tier`, or the override prompt — whatever the start tag named. */
    label: string;
    session: string | null;
    startMs: number;
}

export interface StatusLineState {
    current: PassInFlight | null;
    /** The run's spend as of the last pass-END tag, and what it is drawn
     *  against (the effective ceiling, else the budget). */
    spent: number | null;
    ceiling: number | null;
}

export const INITIAL_STATUS_LINE_STATE: StatusLineState = {
    current: null,
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
        const m = /^pass (\d+) — issue #(\d+) on tier (\S+?)\.?$/.exec(message);
        const p = /^pass (\d+) — (.*?)\.?$/.exec(message);
        return {
            ...state,
            current: {
                pass: m?.[1] ?? p?.[1] ?? "?",
                label: m ? `#${m[2]} · ${m[3]}` : (p?.[2] ?? message),
                session,
                startMs: nowMs,
            },
        };
    }
    if (cls.tag === "end") {
        const f = parseFields(cls.message);
        return {
            current: null,
            spent: num(f.spent) ?? state.spent,
            ceiling: num(f.ceiling) ?? num(f.budget) ?? state.ceiling,
        };
    }
    if (cls.tag === "summary") return { ...state, current: null };
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

/**
 * The status line for `state` at `nowMs`, or null when no pass is in flight
 * (between passes, after the summary) — then nothing is drawn. `activity`
 * null is level A. The line never exceeds `env.width - 1` columns: a line
 * that wraps cannot be erased with one carriage return.
 */
export function formatStatusLine(
    state: StatusLineState,
    activity: PassActivity | null,
    nowMs: number,
    frame: number,
    env: RenderEnv
): string | null {
    const cur = state.current;
    if (!cur) return null;
    const run =
        state.spent === null
            ? "run spend n/a"
            : state.ceiling
              ? `run ${formatTokens(state.spent)}/${formatTokens(state.ceiling)}`
              : `run ${formatTokens(state.spent)}`;
    const parts = [
        paint(env, "cyan", SPINNER[frame % SPINNER.length]),
        paint(env, "bold", `pass ${cur.pass}`),
        cur.label,
        formatDuration((nowMs - cur.startMs) / 1000),
        run,
    ];
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
}
