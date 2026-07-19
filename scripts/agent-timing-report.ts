#!/usr/bin/env bun
/**
 * Aggregates .claude/telemetry/tool-events.jsonl (written by .claude/hooks/timing-log.sh)
 * into a per-session timing report: where wall-clock goes (gates, subagents, skills)
 * and which model each subagent actually ran on.
 *
 * Usage: bun run scripts/agent-timing-report.ts [--session <id>] [--last <n>]
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface Event {
    ts: number;
    phase: "pre" | "post";
    event: string;
    session: string;
    tool: string | null;
    id: string | null;
    skill: string | null;
    agent_desc: string | null;
    agent_type: string | null;
    model: string | null;
    cmd: string | null;
    bg: boolean | null;
    tokens: number | null;
    out_tokens?: number | null;
    in_tokens?: number | null;
    cache_read?: number | null;
    cache_write?: number | null;
    resolved_model?: string | null;
    dur_ms?: number | null;
    tool_uses?: number | null;
}

interface Span {
    tool: string;
    label: string;
    kind:
        | "gate:full-test"
        | "gate:check-all"
        | "gate:partial"
        | "subagent"
        | "skill"
        | "bash";
    model: string | null; // explicit override passed to Agent (null = none)
    resolvedModel: string | null; // model the subagent ACTUALLY ran on (from post)
    agentType: string | null;
    tokens: number | null;
    context: number | null; // peak input context = in + cache_read + cache_write
    start: number;
    seconds: number | null; // null = no matching post (crashed / still running / bg)
}

// read-only / mechanical agent types that should never inherit the session tier
const READONLY_TYPES = new Set(["Explore", "general-purpose"]);
const EXPENSIVE = /opus|fable/i;
const BIG_CONTEXT = 150_000; // usage report flags sessions/subagents above this

const file = join(process.cwd(), ".claude/telemetry/tool-events.jsonl");
if (!existsSync(file)) {
    console.error(
        `No telemetry yet: ${file} missing. Hooks write it from the next session onward.`
    );
    process.exit(1);
}

const events: Event[] = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
        try {
            return JSON.parse(l) as Event;
        } catch {
            return null;
        }
    })
    .filter((e): e is Event => e !== null);

function classify(e: Event): Span["kind"] {
    if (e.tool === "Skill") return "skill";
    if (e.tool === "Task" || e.tool === "Agent") return "subagent";
    const c = e.cmd ?? "";
    if (/check:all/.test(c)) return "gate:check-all";
    if (
        /bun run test(?!\S)(?!.*\S+\.test)/.test(c) ||
        /vitest run(?!.*\.test)/.test(c)
    )
        return "gate:full-test";
    if (
        /vitest|bun run test|check:ts|eslint|check:index|check:stubs|check:ids/.test(
            c
        )
    )
        return "gate:partial";
    return "bash";
}

function label(e: Event): string {
    if (e.skill) return `/${e.skill}`;
    if (e.agent_desc)
        return `${e.agent_desc}${e.agent_type ? ` [${e.agent_type}]` : ""}`;
    return (e.cmd ?? "?").slice(0, 80);
}

// pair pre/post by tool_use_id, fallback FIFO per (session, tool)
const sessions = new Map<string, Span[]>();
const openById = new Map<string, Span>();
const openFifo = new Map<string, Span[]>();

for (const e of events) {
    const key = `${e.session}:${e.tool}`;
    if (e.phase === "pre") {
        const span: Span = {
            tool: e.tool ?? "?",
            label: label(e),
            kind: classify(e),
            model: e.model,
            resolvedModel: null,
            agentType: e.agent_type,
            tokens: null,
            context: null,
            start: e.ts,
            seconds: null,
        };
        if (!sessions.has(e.session)) sessions.set(e.session, []);
        sessions.get(e.session)!.push(span);
        if (e.id) openById.set(e.id, span);
        else {
            if (!openFifo.has(key)) openFifo.set(key, []);
            openFifo.get(key)!.push(span);
        }
    } else {
        const span = e.id ? openById.get(e.id) : openFifo.get(key)?.shift();
        if (e.id) openById.delete(e.id);
        if (span) {
            span.seconds = e.ts - span.start;
            span.tokens = e.tokens;
            span.resolvedModel = e.resolved_model ?? null;
            const ctx =
                (e.in_tokens ?? 0) + (e.cache_read ?? 0) + (e.cache_write ?? 0);
            span.context = ctx > 0 ? ctx : null;
        }
    }
}

const fmt = (s: number | null) =>
    s === null
        ? "   —  "
        : s >= 60
          ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`
          : `${s}s`;

const args = process.argv.slice(2);
const onlySession = args.includes("--session")
    ? args[args.indexOf("--session") + 1]
    : null;
const last = args.includes("--last")
    ? Number(args[args.indexOf("--last") + 1])
    : 3;

const ids = [...sessions.keys()].filter(
    (s) => !onlySession || s.startsWith(onlySession)
);
for (const sid of ids.slice(-last)) {
    const spans = sessions.get(sid)!;
    const t0 = spans[0].start;
    const t1 = Math.max(...spans.map((s) => s.start + (s.seconds ?? 0)));
    console.log(
        `\n=== session ${sid.slice(0, 8)} — span ${fmt(t1 - t0)}, ${spans.length} tracked calls ===`
    );

    const byKind = new Map<string, { n: number; sec: number }>();
    for (const s of spans) {
        const agg = byKind.get(s.kind) ?? { n: 0, sec: 0 };
        agg.n++;
        agg.sec += s.seconds ?? 0;
        byKind.set(s.kind, agg);
    }
    for (const [kind, { n, sec }] of [...byKind.entries()].sort(
        (a, b) => b[1].sec - a[1].sec
    ))
        console.log(
            `  ${kind.padEnd(16)} ${String(n).padStart(3)}×  ${fmt(sec)}`
        );

    const gates = spans.filter((s) => s.kind.startsWith("gate:"));
    if (gates.length) {
        console.log(`  -- gates --`);
        for (const g of gates)
            console.log(
                `    ${fmt(g.seconds).padStart(7)}  ${g.kind.padEnd(14)} ${g.label}`
            );
    }
    const agents = spans.filter((s) => s.kind === "subagent");
    if (agents.length) {
        // leak = read-only agent, no explicit model, actually ran on an expensive tier
        const isLeak = (a: Span) =>
            a.model === null &&
            READONLY_TYPES.has(a.agentType ?? "") &&
            !!a.resolvedModel &&
            EXPENSIVE.test(a.resolvedModel);
        const leaks = agents.filter(isLeak);
        console.log(
            `  -- subagents ${leaks.length ? `(⚠ ${leaks.length} model LEAK — read-only on expensive tier)` : ""}--`
        );
        for (const a of agents) {
            // prefer the resolved model (ground truth); fall back to requested/label
            const shown =
                a.resolvedModel ??
                a.model ??
                (a.seconds === null ? "?(running/bg)" : "?(pre-resolvedModel)");
            const reqNote =
                a.model === null && a.resolvedModel ? " [inherited]" : "";
            const ctxNote =
                a.context !== null
                    ? ` ctx=${Math.round(a.context / 1000)}k${a.context > BIG_CONTEXT ? "⚠" : ""}`
                    : "";
            console.log(
                `    ${fmt(a.seconds).padStart(7)}  ${isLeak(a) ? "⚠ " : "  "}model=${(shown + reqNote).padEnd(30)}${a.tokens ? ` ${a.tokens}tok` : ""}${ctxNote}  ${a.label}`
            );
        }
        const big = agents.filter((a) => (a.context ?? 0) > BIG_CONTEXT);
        if (big.length)
            console.log(
                `    → ${big.length}/${agents.length} subagents ran >${BIG_CONTEXT / 1000}k context (the expensive-even-when-cached band)`
            );
    }
    const skills = spans.filter((s) => s.kind === "skill");
    if (skills.length) {
        console.log(`  -- skills --`);
        for (const k of skills)
            console.log(`    ${fmt(k.seconds).padStart(7)}  ${k.label}`);
    }
}
if (!ids.length) console.log("No sessions in telemetry log.");
