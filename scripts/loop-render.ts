#!/usr/bin/env bun
// scripts/loop-render.ts — the AFK terminal's renderer (PRD #4717, issue
// #4721, ADR 0147). Reads stamped `loop-afk.log` lines on stdin, writes the
// rendered view on stdout. The pure core is `scripts/lib/loop-render.ts`;
// this wrapper only owns the I/O around it:
//
//   * `--plain`, a non-empty `NO_COLOR`, or a stdout that is not a TTY →
//     byte-for-byte passthrough. Rendering is for a human at a terminal.
//   * width follows the terminal, resize included.
//   * a line that throws is printed raw, ONE `loop-render: degraded to plain`
//     notice goes to stderr, and every later line passes through raw — a
//     renderer whose state is suspect must not keep structuring the stream.
//
// `scripts/loop-handoff.sh` runs this as `{ renderer; cat; }` after `tee`, so
// if this process is missing or dies the rest of the stream still reaches the
// terminal plain, and the log was already written before this saw a line.
//
// The live STATUS LINE (issue #4722, `scripts/lib/loop-status-line.ts`) is
// this wrapper's too: drawn only when rendering (so only on a TTY), erased
// before every real line and redrawn after it, ticked every second, its
// transcript read (`scripts/lib/pass-activity.ts`) refreshed every
// `ACTIVITY_REFRESH_MS`. It is written to stdout and nowhere else — it has no
// path into `loop-afk.log`, which `tee` wrote before this process started.
//
// `TOLARIA_LOOP_RENDER_TTY=1` renders as if stdout were a terminal — the one
// seam that lets a test drive the real renderer (status line included)
// through a pipe; `TOLARIA_LOOP_STATUS_TICK_MS` shortens the tick for the same
// test. `CLAUDE_CONFIG_DIR` relocates the transcripts as it does for `claude`.

import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import {
    INITIAL_RENDER_STATE,
    flushPending,
    renderSafely,
    type RenderEnv,
} from "./lib/loop-render";
import {
    INITIAL_STATUS_LINE_STATE,
    formatStatusLine,
    observeStatusLine,
} from "./lib/loop-status-line";
import {
    PassActivityReader,
    projectSlugOf,
    type PassActivity,
} from "./lib/pass-activity";

const DEFAULT_WIDTH = 100;
const DEFAULT_TICK_MS = 1000;
const ACTIVITY_REFRESH_MS = 2000;
/** Erase the current terminal row and return to its first column. */
const ERASE_LINE = "\r\x1b[2K";

function main(): void {
    const tty =
        process.stdout.isTTY || process.env.TOLARIA_LOOP_RENDER_TTY === "1";
    const plain =
        process.argv.includes("--plain") ||
        (process.env.NO_COLOR ?? "") !== "" ||
        !tty;
    const env: RenderEnv = {
        width: process.stdout.columns || DEFAULT_WIDTH,
        color: true,
    };
    process.stdout.on("resize", () => {
        env.width = process.stdout.columns || DEFAULT_WIDTH;
    });

    let state = INITIAL_RENDER_STATE;
    let degraded = plain;

    // ── status line ─────────────────────────────────────────────────────────
    const projectsRoot = path.join(
        process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
        "projects"
    );
    const projectSlug = projectSlugOf(process.cwd());
    const tickMs =
        Number(process.env.TOLARIA_LOOP_STATUS_TICK_MS) || DEFAULT_TICK_MS;
    let status = INITIAL_STATUS_LINE_STATE;
    let statusShown = false;
    let frame = 0;
    let reader: PassActivityReader | null = null;
    let readerSession: string | null = null;
    let activity: PassActivity | null = null;
    let lastActivityMs = 0;
    const refreshActivity = (nowMs: number): void => {
        const session = status.current?.session ?? null;
        if (session !== readerSession) {
            readerSession = session;
            reader = session
                ? new PassActivityReader({ projectsRoot, projectSlug, session })
                : null;
            activity = null;
            lastActivityMs = 0;
        }
        if (!reader || nowMs - lastActivityMs < ACTIVITY_REFRESH_MS) return;
        lastActivityMs = nowMs;
        try {
            activity = reader.refresh();
        } catch {
            // A transcript we cannot read is level A, never a dead renderer.
            activity = null;
        }
    };
    const clearStatus = (): void => {
        if (!statusShown) return;
        process.stdout.write(ERASE_LINE);
        statusShown = false;
    };
    const drawStatus = (): void => {
        if (degraded) return;
        try {
            const nowMs = Date.now();
            refreshActivity(nowMs);
            const line = formatStatusLine(status, activity, nowMs, frame, env);
            if (line === null) return clearStatus();
            process.stdout.write(`${ERASE_LINE}${line}`);
            statusShown = true;
        } catch {
            clearStatus();
        }
    };
    // Any other way out (an uncaught throw, EPIPE) must not leave the line
    // drawn: `render_stream`'s fallback `cat` would append onto that row.
    // `exit` handlers run synchronously, and so does this write.
    process.on("exit", () => {
        if (statusShown) process.stdout.write(ERASE_LINE);
    });
    const ticker = degraded
        ? null
        : setInterval(() => {
              frame++;
              drawStatus();
          }, tickMs);
    ticker?.unref();
    // Best-effort: flushing is for a human watching the terminal, never
    // worth failing loudly over on the way out.
    const flushNow = (): void => {
        clearStatus();
        try {
            const result = flushPending(state, env);
            state = result.state;
            if (result.output.length > 0)
                process.stdout.write(`${result.output.join("\n")}\n`);
        } catch {
            // ignore
        }
    };
    const lines = readline.createInterface({
        input: process.stdin,
        terminal: false,
    });
    lines.on("line", (line) => {
        if (degraded) {
            process.stdout.write(`${line}\n`);
            return;
        }
        const result = renderSafely(state, line, env);
        state = result.state;
        clearStatus();
        process.stdout.write(`${result.output.join("\n")}\n`);
        try {
            status = observeStatusLine(status, line, Date.now());
        } catch {
            // The status line is a nicety; the stream is not.
        }
        if (result.notice === undefined) drawStatus();
        if (result.notice !== undefined) {
            // `renderSafely` leaves `state` — and any block it was
            // buffering — untouched on a throw. Flush that block now,
            // BEFORE switching to raw passthrough, or it is silently
            // abandoned (issue #4718 review).
            flushNow();
            degraded = true;
            if (ticker) clearInterval(ticker);
            process.stderr.write(`${result.notice}\n`);
        }
    });
    // A sweep block still open when the stream ends (the log's last lines
    // were its rows, with nothing after to close it) would otherwise never
    // print — flush it (issue #4718).
    lines.on("close", () => {
        if (ticker) clearInterval(ticker);
        if (!degraded) flushNow();
        clearStatus();
    });
    // `run_foreground()` (loop-handoff.sh) runs this process undetached in
    // the same foreground group as the terminal, so Ctrl-C reaches it
    // directly — readline's `close` never fires on a signal. Without this,
    // a sweep block still buffered at that instant is lost from the
    // terminal for good (the log itself is unaffected either way: `tee`
    // already wrote it before this process ever saw the line).
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.on(signal, () => {
            if (ticker) clearInterval(ticker);
            if (!degraded) flushNow();
            clearStatus();
            process.exit(0);
        });
    }
}

main();
