/**
 * opencode telemetry plugin — writes the same span + outcome events Claude Code
 * records via its hooks, so `bun run telemetry:ingest` mirrors both harnesses
 * into one SQLite store and the dashboard can split them by `harness`.
 *
 * Emits to `.opencode/telemetry/`:
 *   tool-events.jsonl  — pre/post per tool call (id = callID, the analogue of
 *                        Claude's tool_use_id). Only the tools Claude's
 *                        timing-log matcher covers are tracked: `task` (subagent
 *                        spawn), `bash`, `skill`.
 *   facts.jsonl        — `pr-link` facts, so opencode sessions carry the same
 *                        "PR landed" outcome signal Claude's `pr-link` transcript
 *                        events give it.
 *
 * Field names mirror `.claude/hooks/timing-log.sh` byte-for-byte, so the ingest
 * needs no fork: it reads the same JSON shape and tags the row by source.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** opencode tool name → the canonical name the ingest's classifier expects. */
const TOOL_ALIAS: Record<string, string> = {
    task: "Task",
    bash: "Bash",
    skill: "Skill",
};

function writeLine(path: string, obj: Record<string, unknown>): void {
    appendFileSync(path, JSON.stringify(obj) + "\n");
}

function prFromCommand(cmd: string): number | null {
    const m =
        cmd.match(/\bbun (run )?land\s+(\d+)\b/) ||
        cmd.match(/\bpr-merge\.ts\s+(\d+)\b/) ||
        cmd.match(/\bgh pr merge\s+(\d+)\b/);
    return m ? Number(m[2] ?? m[1]) : null;
}

function prFromOutput(output: string | undefined): number | null {
    if (!output) return null;
    const m = output.match(/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/);
    return m ? Number(m[1]) : null;
}

export const Telemetry = async (ctx: { directory: string }) => {
    const dir = join(ctx.directory, ".opencode", "telemetry");
    mkdirSync(dir, { recursive: true });
    const events = join(dir, "tool-events.jsonl");
    const facts = join(dir, "facts.jsonl");

    return {
        "tool.execute.before": async (input: any, output: any) => {
            const tool = TOOL_ALIAS[input.tool];
            if (!tool) return;
            const args = output.args ?? {};
            writeLine(events, {
                ts: Math.floor(Date.now() / 1000),
                phase: "pre",
                event: input.tool,
                session: input.sessionID,
                tool,
                id: input.callID,
                skill: args.name ?? null,
                agent_desc: args.description ?? null,
                agent_type: args.subagent_type ?? null,
                model: null,
                cmd:
                    typeof args.command === "string"
                        ? args.command.slice(0, 160)
                        : null,
                bg: null,
            });
        },
        "tool.execute.after": async (input: any, output: any) => {
            const tool = TOOL_ALIAS[input.tool];
            if (!tool) return;
            writeLine(events, {
                ts: Math.floor(Date.now() / 1000),
                phase: "post",
                event: input.tool,
                session: input.sessionID,
                tool,
                id: input.callID,
            });
            const cmd =
                typeof input.args?.command === "string"
                    ? (input.args.command as string)
                    : "";
            const pr = prFromCommand(cmd) ?? prFromOutput(output.output);
            if (pr) {
                writeLine(facts, {
                    ts: Math.floor(Date.now() / 1000),
                    session: input.sessionID,
                    event: "pr-link",
                    pr,
                });
            }
        },
    };
};
