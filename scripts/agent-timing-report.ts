#!/usr/bin/env bun
/**
 * Aggregates .claude/telemetry/tool-events.jsonl (written by .claude/hooks/timing-log.sh)
 * into a per-session timing report: where wall-clock goes (gates, subagents, skills)
 * and which model each subagent actually ran on.
 *
 * Usage: bun run scripts/agent-timing-report.ts [--session <id>] [--last <n>]
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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
    id: string | null; // tool_use_id, join key to subagent side-files
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
            id: e.id,
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

// --- side-file enrichment ---------------------------------------------------
// The hook payload's tool_response carries only `resolvedModel`, never token
// usage — so `tokens`/`context` from the hook are always null (verified: 0 of
// 538 post events ever had them). Ground truth for per-subagent out_tokens +
// peak context lives in the per-subagent transcript side-files:
//   ~/.claude/projects/<projDir>/<session>/subagents/agent-<agentId>.jsonl   (message.usage + message.model per turn)
//   ~/.claude/projects/<projDir>/<session>/subagents/agent-<agentId>.meta.json ({toolUseId,…})
// Join key: meta.toolUseId === hook event id. projDir varies (worktree sessions
// encode a different cwd), so we locate the session dir by scanning projects/.
const projectsRoot = join(homedir(), ".claude", "projects");
const sideFileCache = new Map<
    string,
    Map<string, { tokens: number; context: number; model: string | null }>
>();

function subagentDirFor(session: string): string | null {
    if (!existsSync(projectsRoot)) return null;
    for (const proj of readdirSync(projectsRoot)) {
        const dir = join(projectsRoot, proj, session, "subagents");
        if (existsSync(dir)) return dir;
    }
    return null;
}

// toolUseId -> aggregated usage for one session, read once and memoised
function sideFileUsage(session: string) {
    const cached = sideFileCache.get(session);
    if (cached) return cached;
    const out = new Map<
        string,
        { tokens: number; context: number; model: string | null }
    >();
    sideFileCache.set(session, out);
    const dir = subagentDirFor(session);
    if (!dir) return out;
    for (const f of readdirSync(dir)) {
        if (!f.endsWith(".meta.json")) continue;
        const agentId = f.slice("agent-".length, -".meta.json".length);
        let toolUseId: string | null = null;
        try {
            toolUseId = JSON.parse(
                readFileSync(join(dir, f), "utf8")
            ).toolUseId;
        } catch {
            continue;
        }
        if (!toolUseId) continue;
        const jsonl = join(dir, `agent-${agentId}.jsonl`);
        if (!existsSync(jsonl)) continue;
        let outTok = 0;
        let peakCtx = 0;
        let model: string | null = null;
        for (const line of readFileSync(jsonl, "utf8").split("\n")) {
            if (!line) continue;
            let rec: {
                message?: {
                    model?: string;
                    usage?: {
                        output_tokens?: number;
                        input_tokens?: number;
                        cache_read_input_tokens?: number;
                        cache_creation_input_tokens?: number;
                    };
                };
            };
            try {
                rec = JSON.parse(line);
            } catch {
                continue;
            }
            const u = rec.message?.usage;
            if (u) {
                outTok += u.output_tokens ?? 0;
                const ctx =
                    (u.input_tokens ?? 0) +
                    (u.cache_read_input_tokens ?? 0) +
                    (u.cache_creation_input_tokens ?? 0);
                if (ctx > peakCtx) peakCtx = ctx;
            }
            if (rec.message?.model) model = rec.message.model;
        }
        out.set(toolUseId, { tokens: outTok, context: peakCtx, model });
    }
    return out;
}

// patch a session's subagent spans with side-file ground truth (out_tokens,
// peak context, resolved model). Called lazily per rendered session.
function enrichSession(session: string, spans: Span[]) {
    const subs = spans.filter((s) => s.tool === "Task" || s.tool === "Agent");
    if (!subs.length) return;
    const usage = sideFileUsage(session);
    for (const s of subs) {
        const u = s.id != null ? usage.get(s.id) : undefined;
        if (!u) continue;
        if (u.tokens > 0) s.tokens = u.tokens;
        if (u.context > 0) s.context = u.context;
        if (!s.resolvedModel && u.model) s.resolvedModel = u.model;
    }
}

const fmt = (s: number | null) =>
    s === null
        ? "   —  "
        : s >= 60
          ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`
          : `${s}s`;

// --scorecard: the two headline cost measures across ALL sessions' side-files
// (general-purpose out-token share + % of subagents in the >150k context band).
// These are the metrics the built-in usage report surfaces; before side-file
// enrichment the hook could never produce them (0 of 538 events had tokens).
function printScorecard() {
    if (!existsSync(projectsRoot)) {
        console.log("No transcript side-files under", projectsRoot);
        return;
    }
    let n = 0;
    let over150 = 0;
    let totOut = 0;
    let totCtx = 0;
    const byType = new Map<string, { n: number; out: number; over: number }>();
    const bands = { "<50k": 0, "50-100k": 0, "100-150k": 0, ">150k": 0 };
    for (const proj of readdirSync(projectsRoot)) {
        const pdir = join(projectsRoot, proj);
        let sess: string[];
        try {
            sess = readdirSync(pdir);
        } catch {
            continue;
        }
        for (const s of sess) {
            const sub = join(pdir, s, "subagents");
            if (!existsSync(sub)) continue;
            for (const f of readdirSync(sub)) {
                if (!f.endsWith(".jsonl")) continue;
                const agentId = f.slice("agent-".length, -".jsonl".length);
                let atype = "?";
                try {
                    atype =
                        JSON.parse(
                            readFileSync(
                                join(sub, `agent-${agentId}.meta.json`),
                                "utf8"
                            )
                        ).agentType ?? "?";
                } catch {
                    /* no meta */
                }
                let out = 0;
                let peak = 0;
                for (const l of readFileSync(join(sub, f), "utf8").split(
                    "\n"
                )) {
                    if (!l) continue;
                    let r: {
                        message?: {
                            usage?: {
                                output_tokens?: number;
                                input_tokens?: number;
                                cache_read_input_tokens?: number;
                                cache_creation_input_tokens?: number;
                            };
                        };
                    };
                    try {
                        r = JSON.parse(l);
                    } catch {
                        continue;
                    }
                    const u = r.message?.usage;
                    if (!u) continue;
                    out += u.output_tokens ?? 0;
                    const c =
                        (u.input_tokens ?? 0) +
                        (u.cache_read_input_tokens ?? 0) +
                        (u.cache_creation_input_tokens ?? 0);
                    if (c > peak) peak = c;
                }
                if (out === 0 && peak === 0) continue;
                n++;
                totOut += out;
                totCtx += peak;
                if (peak > BIG_CONTEXT) over150++;
                const band =
                    peak < 50_000
                        ? "<50k"
                        : peak < 100_000
                          ? "50-100k"
                          : peak < BIG_CONTEXT
                            ? "100-150k"
                            : ">150k";
                bands[band]++;
                const row = byType.get(atype) ?? { n: 0, out: 0, over: 0 };
                row.n++;
                row.out += out;
                if (peak > BIG_CONTEXT) row.over++;
                byType.set(atype, row);
            }
        }
    }
    if (!n) {
        console.log("No subagent side-files with usage found.");
        return;
    }
    console.log(
        `=== SCORECARD — ${n} subagents (all sessions, side-files) ===`
    );
    console.log(
        `total out-tokens ${Math.round(totOut / 1000)}k | avg peak ctx ${Math.round(totCtx / n / 1000)}k`
    );
    console.log(
        `>${BIG_CONTEXT / 1000}k ctx band: ${over150}/${n} = ${((100 * over150) / n).toFixed(1)}% (expensive-even-when-cached)`
    );
    console.log(
        `ctx distribution: <50k ${bands["<50k"]} | 50-100k ${bands["50-100k"]} | 100-150k ${bands["100-150k"]} | >150k ${bands[">150k"]}`
    );
    console.log(`-- out-token share by agent type --`);
    for (const [t, v] of [...byType.entries()].sort(
        (a, b) => b[1].out - a[1].out
    ))
        console.log(
            `  ${t.padEnd(24)} n=${String(v.n).padStart(4)}  out=${(Math.round(v.out / 1000) + "k").padStart(7)} (${((100 * v.out) / totOut).toFixed(0).padStart(3)}%)  >150k=${v.over}`
        );
}

const args = process.argv.slice(2);
if (args.includes("--scorecard")) {
    printScorecard();
    process.exit(0);
}
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
    enrichSession(sid, spans);
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
        // scorecard: the two headline measures (out-token volume + peak-context band)
        const measured = agents.filter((a) => a.tokens != null);
        if (measured.length) {
            const totOut = measured.reduce((n, a) => n + (a.tokens ?? 0), 0);
            const peak = Math.max(...agents.map((a) => a.context ?? 0));
            console.log(
                `    scorecard: ${Math.round(totOut / 1000)}k out-tokens across ${measured.length} measured subagent${measured.length > 1 ? "s" : ""}, peak ctx ${Math.round(peak / 1000)}k`
            );
        }
    }
    const skills = spans.filter((s) => s.kind === "skill");
    if (skills.length) {
        console.log(`  -- skills --`);
        for (const k of skills)
            console.log(`    ${fmt(k.seconds).padStart(7)}  ${k.label}`);
    }
}
if (!ids.length) console.log("No sessions in telemetry log.");
