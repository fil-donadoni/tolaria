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

import * as readline from "node:readline";
import {
    INITIAL_RENDER_STATE,
    flushPending,
    renderSafely,
    type RenderEnv,
} from "./lib/loop-render";

const DEFAULT_WIDTH = 100;

function main(): void {
    const plain =
        process.argv.includes("--plain") ||
        (process.env.NO_COLOR ?? "") !== "" ||
        !process.stdout.isTTY;
    const env: RenderEnv = {
        width: process.stdout.columns || DEFAULT_WIDTH,
        color: true,
    };
    process.stdout.on("resize", () => {
        env.width = process.stdout.columns || DEFAULT_WIDTH;
    });

    let state = INITIAL_RENDER_STATE;
    let degraded = plain;
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
        process.stdout.write(`${result.output.join("\n")}\n`);
        if (result.notice !== undefined) {
            degraded = true;
            process.stderr.write(`${result.notice}\n`);
        }
    });
    // A sweep block still open when the stream ends (the log's last lines
    // were its rows, with nothing after to close it) would otherwise never
    // print — flush it (issue #4718).
    lines.on("close", () => {
        if (degraded) return;
        try {
            const result = flushPending(state, env);
            if (result.output.length > 0)
                process.stdout.write(`${result.output.join("\n")}\n`);
        } catch {
            // Best-effort: the stream is ending anyway, and this is not
            // worth a crash on the way out.
        }
    });
}

main();
