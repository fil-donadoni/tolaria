#!/usr/bin/env bun
/**
 * `bun run cr:audit` — assess CR citations against the printed rule and
 * propose corrections (issue #3675). Run by hand, NEVER by a gate: it calls
 * the model, and the gate is offline by contract (ADR 0098).
 *
 *   bun run cr:audit collect [--path <prefix>]... [--issues] [--no-tree]
 *   bun run cr:audit assess  [--budget <groups>] [--concurrency <n>]
 *   bun run cr:audit report
 *   bun run cr:audit apply   [--confirm-issues <n,n>]
 *
 * Each stage reads the previous stage's artifact from the work directory
 * (`--dir`, default `.cr-audit/` in the primary checkout — gitignored, and
 * outside the worktree so the paid-for cache survives `land`):
 *
 *   collected.json     the units in scope, with their claims
 *   assessments.jsonl  the cache — append-only, keyed by the ledger's key +
 *                      the printed rule's hash
 *   report.md          every wrong / unclear beside the rule texts
 *   review.json        one entry per assessed citation; a reviewer sets
 *                      `decision` ("fix" | "correct" | "skip") — `apply`
 *                      refuses every entry still `null`
 *
 * The API key comes from `CONVEX_ANTHROPIC_API_KEY` (the local env stashes it
 * under that name and never exports a bare `ANTHROPIC_API_KEY`, which would
 * shadow the claude.ai login of every `claude` child) and is passed to the
 * client explicitly.
 */
import Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "node:child_process";
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { knownRuleIds, readSources } from "./check-cr-citations.ts";
import {
    applyReview,
    assess,
    AUDIT_SYSTEM_PROMPT,
    buildReport,
    collect,
    formatReport,
    issueSources,
    mergeReview,
    parseCache,
    renderPrompt,
    serializeAssessments,
    VERDICT_SCHEMA,
    type AssessClient,
    type AssessResponse,
    type AuditUnit,
    type GhIssue,
    type IssueRef,
    type Review,
} from "./lib/cr-audit.ts";
import { loadRules } from "./lib/cr-rules.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Per the claude-api skill: the current default model. */
const AUDIT_MODEL = "claude-opus-5";
const FALLBACK_MODEL = "claude-opus-4-8";

type Args = { cmd: string | undefined; flags: Map<string, string[]> };

function parseArgs(argv: string[]): Args {
    const flags = new Map<string, string[]>();
    let cmd: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) {
            cmd ??= a;
            continue;
        }
        const name = a.slice(2);
        const value =
            argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")
                ? argv[++i]
                : "true";
        flags.set(name, [...(flags.get(name) ?? []), value]);
    }
    return { cmd, flags };
}

function workDir(args: Args): string {
    const given = args.flags.get("dir")?.[0];
    if (given) return isAbsolute(given) ? given : resolve(given);
    const common = execFileSync(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd: ROOT, encoding: "utf8" }
    ).trim();
    return join(dirname(common), ".cr-audit");
}

type Collected = { scope: string[]; issues: boolean; units: AuditUnit[] };

function readJson<T>(path: string, what: string): T {
    if (!existsSync(path))
        throw new Error(
            `${path} is missing — run \`bun run cr:audit ${what}\` first`
        );
    return JSON.parse(readFileSync(path, "utf8")) as T;
}

function fetchOpenIssues(): GhIssue[] {
    const out = execFileSync(
        "gh",
        [
            "issue",
            "list",
            "--state",
            "open",
            "--limit",
            "2000",
            "--json",
            "number,state,body,comments",
        ],
        { cwd: ROOT, encoding: "utf8", maxBuffer: 256 << 20 }
    );
    return JSON.parse(out) as GhIssue[];
}

function cmdCollect(args: Args, dir: string): number {
    const scope = args.flags.get("path") ?? [];
    const withIssues = args.flags.has("issues");
    const withTree = !args.flags.has("no-tree");
    const inScope = (file: string) =>
        !scope.length || scope.some((p) => file.startsWith(p));
    const sources = [
        ...(withTree ? readSources(ROOT).filter((s) => inScope(s.file)) : []),
        ...(withIssues ? issueSources(fetchOpenIssues()) : []),
    ];
    const { citations, units } = collect(sources, knownRuleIds());
    const collected: Collected = { scope, issues: withIssues, units };
    writeFileSync(join(dir, "collected.json"), JSON.stringify(collected));
    console.log(
        `collected ${citations.length} citations → ${units.length} units (${sources.length} sources${scope.length ? `, scope ${scope.join(" ")}` : ""}${withIssues ? ", open issues" : ""})`
    );
    return 0;
}

function anthropicClient(): AssessClient {
    const apiKey = process.env.CONVEX_ANTHROPIC_API_KEY;
    if (!apiKey)
        throw new Error(
            "CONVEX_ANTHROPIC_API_KEY is not set (it lives in .env.local; a bare ANTHROPIC_API_KEY is deliberately not read)"
        );
    const client = new Anthropic({ apiKey });
    return async (req) => {
        const res = await client.beta.messages.create({
            model: AUDIT_MODEL,
            max_tokens: 16000,
            betas: ["server-side-fallback-2026-06-01"],
            fallbacks: [{ model: FALLBACK_MODEL }],
            system: AUDIT_SYSTEM_PROMPT,
            output_config: {
                format: { type: "json_schema", schema: VERDICT_SCHEMA },
            },
            messages: [{ role: "user", content: renderPrompt(req) }],
        });
        if (res.stop_reason === "refusal")
            throw new Error(`model refused (CR ${req.id})`);
        if (res.stop_reason === "max_tokens")
            throw new Error(`reply truncated at max_tokens (CR ${req.id})`);
        const text = res.content
            .map((b) => (b.type === "text" ? b.text : ""))
            .join("");
        const parsed = JSON.parse(text) as Omit<AssessResponse, "model">;
        return { ...parsed, model: res.model };
    };
}

async function cmdAssess(args: Args, dir: string): Promise<number> {
    const collected = readJson<Collected>(
        join(dir, "collected.json"),
        "collect"
    );
    const cachePath = join(dir, "assessments.jsonl");
    const cache = existsSync(cachePath)
        ? parseCache(readFileSync(cachePath, "utf8"))
        : new Map();
    const budget = Number(args.flags.get("budget")?.[0] ?? "20");
    const concurrency = Number(args.flags.get("concurrency")?.[0] ?? "4");
    if (!Number.isInteger(budget) || budget < 0) {
        console.error(
            `--budget takes a non-negative integer (groups = cited ids)`
        );
        return 2;
    }
    const summary = await assess({
        units: collected.units,
        rules: loadRules(),
        ids: knownRuleIds(),
        cache,
        client: anthropicClient(),
        budget,
        concurrency,
        onAssessed: (batch) =>
            appendFileSync(cachePath, serializeAssessments(batch)),
    });
    const by = (v: string) =>
        summary.assessed.filter((a) => a.verdict === v).length;
    console.log(
        `assessed ${summary.assessed.length} (correct ${by("correct")}, wrong ${by("wrong")}, unclear ${by("unclear")}) in ${summary.calls} calls; ` +
            `${summary.cached} cached, ${summary.deferredGroups} ids deferred by --budget ${budget}, ` +
            `${summary.unanswered} unanswered, ${summary.unresolvable} unresolvable`
    );
    for (const e of summary.errors) console.error(`  CR ${e.id}: ${e.message}`);
    return summary.errors.length ? 1 : 0;
}

function cmdReport(dir: string): number {
    const collected = readJson<Collected>(
        join(dir, "collected.json"),
        "collect"
    );
    const cachePath = join(dir, "assessments.jsonl");
    const cache = existsSync(cachePath)
        ? parseCache(readFileSync(cachePath, "utf8"))
        : new Map();
    const rules = loadRules();
    const report = buildReport(collected.units, rules, cache);
    const reviewPath = join(dir, "review.json");
    const prior = existsSync(reviewPath)
        ? (JSON.parse(readFileSync(reviewPath, "utf8")) as Review)
        : null;
    writeFileSync(join(dir, "report.md"), formatReport(report, rules));
    writeFileSync(
        reviewPath,
        `${JSON.stringify(mergeReview(report.entries, prior), null, 2)}\n`
    );
    const c = report.counts;
    console.log(
        `correct ${c.correct} · wrong ${c.wrong} · unclear ${c.unclear} · pending ${c.pending} · unresolvable ${c.unresolvable}\n` +
            `${join(dir, "report.md")}\n${reviewPath} — set "decision" on each entry you reviewed, then \`bun run cr:audit apply\``
    );
    return 0;
}

function repoSlug(): string {
    return execFileSync(
        "gh",
        ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
        { cwd: ROOT, encoding: "utf8" }
    ).trim();
}

async function cmdApply(args: Args, dir: string): Promise<number> {
    const review = readJson<Review>(join(dir, "review.json"), "report");
    const confirmed = new Set(
        (args.flags.get("confirm-issues") ?? [])
            .flatMap((v) => v.split(","))
            .map(Number)
    );
    let slug: string | null = null;
    const summary = await applyReview(review, knownRuleIds(), {
        readTree: (file) => readFileSync(join(ROOT, file), "utf8"),
        writeTree: (file, text) => writeFileSync(join(ROOT, file), text),
        confirmTreeLine: (file, line) =>
            execFileSync(
                "bun",
                ["scripts/cr-ledger.ts", "confirm", `${file}:${line}`],
                {
                    cwd: ROOT,
                    stdio: "inherit",
                }
            ),
        fetchIssueText: async (ref: IssueRef) => {
            slug ??= repoSlug();
            const path =
                ref.commentId === null
                    ? `repos/${slug}/issues/${ref.issue}`
                    : `repos/${slug}/issues/comments/${ref.commentId}`;
            const body = JSON.parse(
                execFileSync("gh", ["api", path], {
                    cwd: ROOT,
                    encoding: "utf8",
                })
            ) as { body: string };
            // A comment has no state of its own; its issue's is what matters.
            const state = execFileSync(
                "gh",
                [
                    "issue",
                    "view",
                    String(ref.issue),
                    "--json",
                    "state",
                    "--jq",
                    ".state",
                ],
                { cwd: ROOT, encoding: "utf8" }
            ).trim();
            return { state, text: body.body ?? "" };
        },
        writeIssueText: async (ref, text) => {
            slug ??= repoSlug();
            const path =
                ref.commentId === null
                    ? `repos/${slug}/issues/${ref.issue}`
                    : `repos/${slug}/issues/comments/${ref.commentId}`;
            execFileSync("gh", ["api", "-X", "PATCH", path, "--input", "-"], {
                cwd: ROOT,
                input: JSON.stringify({ body: text }),
                encoding: "utf8",
            });
        },
        issueConfirmed: (issue) => confirmed.has(issue),
        log: (m) => console.log(m),
    });
    console.log(
        `rewritten ${summary.rewritten.length}, confirmed ${summary.confirmed.length}, ` +
            `unreviewed ${summary.unreviewed} (not applied), refused ${summary.refused.length}`
    );
    for (const r of summary.rewritten) console.log(`  rewrote   ${r}`);
    for (const u of summary.unconfirmed)
        console.log(`  NOT confirmed ${u.site}: ${u.why}`);
    for (const r of summary.refused)
        console.log(`  refused   ${r.site ?? r.key}: ${r.why}`);
    for (const f of summary.issuesWritten) console.log(`  wrote     ${f}`);
    if (summary.issuesAwaitingConfirmation.length) {
        const nums = [
            ...new Set(
                summary.issuesAwaitingConfirmation.map(
                    (f) => f.match(/\d+/)?.[0]
                )
            ),
        ];
        console.log(
            `\n${summary.issuesAwaitingConfirmation.length} issue text(s) NOT written. Read the diff above, then re-run with ` +
                `--confirm-issues ${nums.join(",")}`
        );
    }
    return summary.refused.length ? 1 : 0;
}

function usage(): number {
    console.error(
        [
            "usage:",
            "  bun run cr:audit collect [--path <prefix>]... [--issues] [--no-tree]",
            "  bun run cr:audit assess  [--budget <groups>] [--concurrency <n>]",
            "  bun run cr:audit report",
            "  bun run cr:audit apply   [--confirm-issues <n,n>]",
            "  (every stage takes --dir <work dir>; default .cr-audit/ in the primary checkout)",
        ].join("\n")
    );
    return 2;
}

async function main(): Promise<number> {
    const args = parseArgs(process.argv.slice(2));
    const dir = workDir(args);
    mkdirSync(dir, { recursive: true });
    switch (args.cmd) {
        case "collect":
            return cmdCollect(args, dir);
        case "assess":
            return cmdAssess(args, dir);
        case "report":
            return cmdReport(dir);
        case "apply":
            return cmdApply(args, dir);
        default:
            return usage();
    }
}

if (import.meta.main) {
    main().then(
        (code) => process.exit(code),
        (err) => {
            console.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    );
}
