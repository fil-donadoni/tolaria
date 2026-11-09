// The SYSTEM bug-report channel (issue #9000, PRD issue #8998): a Bot fault is
// filed by the server, with no user as sender, as a P0 GitHub issue grouped by
// fingerprint. Pure and client-importable (no `ctx`, no Convex-server import):
// the fault validator the schema stores, the fingerprint, the issue payload and
// the dedupe / rate-limit planner. The Convex wiring — the row insert, the
// scheduled filing action — lives in `convex/bugReports.ts`, beside the user
// channel it shares the `bugReports` table with.
//
// Same public/private split as the user channel (`buildIssuePayload`): the
// tracker repo is PUBLIC. The issue carries the window kind, the owed
// container's source card name, the fault class, the recovery step names, the
// board summary (`buildGameStateSection`'s facts) and the row id. The frozen
// state, the client diagnostics and the raw error message stay on the row —
// an engine error message may quote a card from a hidden zone, so it reaches
// the issue only through the fingerprint's hash.
import { v, type Infer } from "convex/values";

/** Which layer of the liveness guarantee recovered the game (PRD issue #8998,
 *  story 19): the client ladder, the client's hand-off to the server, or the
 *  server deadline firing because no client acted. */
export const botFaultOriginValidator = v.union(
    v.literal("client-ladder"),
    v.literal("client-handoff"),
    v.literal("server-deadline")
);

/** One step of the recovery (`forceAdvanceOwedInput`'s step log): the engine
 *  step tried, whether it worked, and whether it was the forced discard — the
 *  explicit CR deviation owner-ruled 2026-11-09, which the issue must tell apart
 *  from a legal decline. `message` stays on the row (it may quote a card). */
export const botFaultStepValidator = v.object({
    step: v.string(),
    ok: v.boolean(),
    discarded: v.optional(v.boolean()),
    message: v.optional(v.string()),
});

export const botFaultValidator = v.object({
    origin: botFaultOriginValidator,
    /** `ExpectedInputKind` of the window the Bot was owed. A string here so the
     *  schema does not depend on the engine module that defines the union. */
    expectedKind: v.string(),
    choiceKind: v.optional(v.string()),
    targetType: v.optional(v.string()),
    /** Name of the card whose stack item / ability raised the owed container. */
    sourceCardName: v.optional(v.string()),
    /** What went wrong: `driver-error`, `unanswered`, `rejected`, … */
    faultClass: v.string(),
    errorMessage: v.optional(v.string()),
    steps: v.array(botFaultStepValidator),
});

export type BotFault = Infer<typeof botFaultValidator>;

/** Labels stamped on every system-filed issue. `bug` + `bot-fault` is what
 *  `issue:workflow-band` raises to board Priority `P0`. */
export const BOT_FAULT_LABELS = [
    "bug",
    "area:game-bot",
    "bot-fault",
    "ready-for-agent",
] as const;

/** The modules a Bot-fault fix touches — the issue's `## Target files`, so the
 *  planner can schedule it (issue #8937: no radius, no pick). */
export const BOT_FAULT_TARGET_FILES = [
    "convex/gre/**",
    "src/lib/ai/**",
    "src/hooks/useVsAiDriver.ts",
] as const;

/** Display name a system row carries in the `name` column. */
export const SYSTEM_REPORTER_NAME = "System";

/** ≤ 3 system reports per game reach GitHub (PRD issue #8998). */
export const SYSTEM_REPORTS_PER_GAME_CAP = 3;
/** Global cap on system reports reaching GitHub per rolling hour. */
export const SYSTEM_REPORTS_PER_HOUR_CAP = 10;
export const SYSTEM_REPORT_WINDOW_MS = 60 * 60 * 1000;

const ERROR_HEAD_MAX = 120;

/**
 * The error message reduced to what identifies the FAULT rather than the
 * occurrence: first line, lower-cased, ids and numbers folded, whitespace
 * collapsed. "card k57abc… not found at seq 41" and the same throw at seq 90
 * must group onto one issue.
 */
export function normalizeErrorHead(message: string | undefined): string {
    if (!message) return "";
    const firstLine = message.split("\n")[0] ?? "";
    return firstLine
        .toLowerCase()
        .replace(/\b[a-z0-9_-]*\d[a-z0-9_-]{15,}\b/g, "<id>")
        .replace(/\d+/g, "#")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, ERROR_HEAD_MAX);
}

/** 64-bit FNV-1a, hex. Sync and dependency-free so the fingerprint is the same
 *  in a mutation, an action and a test. */
function fnv1a64(text: string): string {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mask = 0xffffffffffffffffn;
    for (const byte of new TextEncoder().encode(text)) {
        hash ^= BigInt(byte);
        hash = (hash * prime) & mask;
    }
    return hash.toString(16).padStart(16, "0");
}

/**
 * Groups occurrences of one fault class: (`expectedKind`, `choiceKind` /
 * `targetType`, source card name, fault class, normalised error head). The
 * origin and the step log are deliberately OUT — the same engine bug recovered
 * by the client once and by the deadline once is still one issue.
 */
export function botFaultFingerprint(fault: BotFault): string {
    const key = [
        fault.expectedKind,
        fault.choiceKind ?? "",
        fault.targetType ?? "",
        fault.sourceCardName ?? "",
        fault.faultClass,
        normalizeErrorHead(fault.errorMessage),
    ].join("\u0000");
    return `bf-${fnv1a64(key)}`;
}

/** `<expectedKind> — <card> — <fault class>`: the title's tail, and the
 *  system row's `description` (what the admin list previews). */
export function botFaultHeadline(fault: BotFault): string {
    const kind = fault.choiceKind ?? fault.targetType;
    const window = kind ? `${fault.expectedKind}/${kind}` : fault.expectedKind;
    return `${window} — ${fault.sourceCardName ?? "no source card"} — ${fault.faultClass}`;
}

/** What the recovery came to, read off the step log: the step that worked,
 *  flagged when it was the forced discard; `none` when nothing did. */
export function botFaultRecovery(fault: BotFault): string {
    const worked = fault.steps.find((s) => s.ok);
    if (!worked) return "none";
    return worked.discarded ? `${worked.step} (forced discard)` : worked.step;
}

export type BotFaultIssueInput = {
    fault: BotFault;
    fingerprint: string;
    reportId: string;
    /** `buildGameStateSection(snapshot)` — the public board summary. */
    gameSection: string | null;
};

/** The command an agent runs to start from a row's frozen position
 *  (`scripts/bug-report-pull.ts`, issue #9005). One builder, so the issue body
 *  and its test cannot name two spellings. */
export function bugReportPullCommand(reportId: string): string {
    return `bun run bug-report:pull ${reportId} --prod --out bug-report-${reportId}.json`;
}

/**
 * The create-issue request body for a system report. Takes no state, no
 * diagnostics and reads no error message — a field that never reaches the
 * builder cannot be leaked by a later edit to the template.
 */
export function buildBotFaultIssueRequest(input: BotFaultIssueInput): {
    title: string;
    body: string;
    labels: readonly string[];
} {
    const { fault, fingerprint, reportId } = input;
    const facts = [
        `**Window:** \`${fault.expectedKind}\``,
        fault.choiceKind ? `**Choice kind:** \`${fault.choiceKind}\`` : null,
        fault.targetType ? `**Target type:** \`${fault.targetType}\`` : null,
        `**Source card:** ${fault.sourceCardName ?? "—"}`,
        `**Fault class:** \`${fault.faultClass}\``,
        `**Recovered by:** \`${fault.origin}\` → ${botFaultRecovery(fault)}`,
    ].filter((l): l is string => l !== null);
    const steps = fault.steps.map(
        (s, i) =>
            `${i + 1}. \`${s.step}\` — ${s.ok ? "ok" : "failed"}${s.discarded ? " (forced discard: CR deviation)" : ""}`
    );
    const body = [
        "The Bot faulted in a vs-AI game and the system filed this report (PRD issue #8998). The game was advanced without waiting on the Bot.",
        "",
        ...facts,
        "",
        "**Recovery steps:**",
        ...(steps.length > 0 ? steps : ["_none recorded_"]),
        ...(input.gameSection ? ["", input.gameSection] : []),
        "",
        `**Fingerprint:** \`${fingerprint}\` — later occurrences comment here while this issue is open.`,
        "",
        `**Report:** \`${reportId}\` — the frozen game state, the Bot telemetry and the error message are on the report row, not here (public repo). Read it with:`,
        "",
        "```",
        `bunx convex run bugReports:getReport '{"reportId":"${reportId}"}' --prod`,
        "```",
        "",
        "Start from the exact position — the frozen state lowered to a `ScenarioSpec`, with everything the lowering could not carry (`dropped[]`) and the client diagnostics summary (issue #9005):",
        "",
        "```",
        bugReportPullCommand(reportId),
        "```",
        "",
        "## Target files",
        "",
        ...BOT_FAULT_TARGET_FILES.map((p) => `- \`${p}\``),
        "",
        "## Band",
        "",
        "P0 — a Bot fault is a blocking defect class (PRD issue #8998).",
        "",
        "_Filed by the system (Bot liveness)._",
    ];
    return {
        title: `[Bot Fault] ${botFaultHeadline(fault)}`,
        body: body.join("\n"),
        labels: BOT_FAULT_LABELS,
    };
}

/** The comment a recurring fault adds to its open issue. */
export function buildBotFaultOccurrenceComment(input: {
    reportId: string;
    fault: BotFault;
}): string {
    return `+1 occurrence, row \`${input.reportId}\` (\`${input.fault.origin}\` → ${botFaultRecovery(input.fault)}).`;
}

export type SystemReportFilingInput = {
    /** System rows of the same game filed BEFORE this one. */
    priorGameReports: number;
    /** System rows of any game filed in the hour before this one. */
    priorHourReports: number;
    /** The issue the fingerprint last filed, with its live state, if any. */
    existingIssue: { number: number; open: boolean } | null;
};

export type SystemReportFilingPlan =
    | { kind: "create" }
    | { kind: "comment"; issueNumber: number }
    | { kind: "skip"; reason: string };

/** The cap a report is over, or `null`. Counts are of ROWS filed before this
 *  one, so a row's verdict is fixed when it is written — two concurrent
 *  filings cannot both slip under a cap. */
export function systemReportCapReason(
    input: Pick<
        SystemReportFilingInput,
        "priorGameReports" | "priorHourReports"
    >
): string | null {
    if (input.priorGameReports >= SYSTEM_REPORTS_PER_GAME_CAP) {
        return `per-game cap (${SYSTEM_REPORTS_PER_GAME_CAP}) reached`;
    }
    if (input.priorHourReports >= SYSTEM_REPORTS_PER_HOUR_CAP) {
        return `hourly cap (${SYSTEM_REPORTS_PER_HOUR_CAP}) reached`;
    }
    return null;
}

/**
 * What the filing action does with GitHub for one system row: skip (over a
 * cap — the row is already written, only the GitHub call is lost), comment on
 * the fingerprint's OPEN issue, or open a new one (none yet, or it was closed:
 * a closed issue is a fix that did not hold, and deserves a fresh work item).
 */
export function planSystemReportFiling(
    input: SystemReportFilingInput
): SystemReportFilingPlan {
    const capped = systemReportCapReason(input);
    if (capped !== null) return { kind: "skip", reason: capped };
    if (input.existingIssue?.open) {
        return { kind: "comment", issueNumber: input.existingIssue.number };
    }
    return { kind: "create" };
}
