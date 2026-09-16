/**
 * `cr:audit` — the CR citation audit (issue #3675), pure over its inputs.
 *
 * `cr:lint` proves a cited id EXISTS; the ledger (ADR 0133, issue #3674)
 * proves a reader CHECKED the line — but seeded every citation already in the
 * tree as `baseline`, never checked. Every "resolvable but wrong" citation
 * found so far was found by a human printing the rule. This module is the
 * three stages of the out-of-gate audit that works through that baseline:
 *
 *   1. collect — the citations, through the existence scan's own walk
 *      (`scanCitations`), each with the CLAIM around it: the contiguous
 *      comment block in code, the paragraph or table row in markdown and in
 *      open GitHub issues. The claim is often on the neighbouring line.
 *   2. assess  — one group per cited id, sent through an injectable
 *      `AssessClient` with the printed rule, its parent and its siblings (the
 *      usual mistake is a neighbouring letter or a renumbered section). A
 *      proposal that resolves to no rule is discarded. Results are cached by
 *      the ledger's own key plus the printed rule's hash, so a re-run never
 *      re-pays for an unchanged citation and a `cr:sync` that rewrites a rule
 *      reopens exactly its citations.
 *   3. report + apply — every `wrong` and `unclear`, side by side with the
 *      rule text; nothing is rewritten until a reviewer records a decision,
 *      and promotion to `confirmed` goes through `cr:ledger confirm` — the
 *      ledger's one writer. A model `correct` alone confirms nothing.
 *
 * No model call ever runs inside a gate (ADR 0098): nothing here is imported
 * by `cr:lint`, `check:all` or any test that touches the network.
 */
import { scanCitations } from "../check-cr-citations.ts";
import {
    entryKey,
    isExempt,
    normalizeLine,
    treeCitations,
    type Citation,
    type Site,
} from "./cr-ledger.ts";
import { printedRule, ruleHash, type Rule } from "./cr-rules.ts";

// ── Collect ────────────────────────────────────────────────────────────────

export type Source = { file: string; text: string };

/** One citation to assess: the ledger's (id, normalized line) plus claims. */
export type AuditUnit = {
    id: string;
    line: string;
    sites: Site[];
    /** The claim around the FIRST site — what the model reads. */
    claim: string;
};

/** Where an issue citation lives: an open issue's body or one comment. */
export type IssueRef = { issue: number; commentId: number | null };

const ISSUE_FILE = /^issue#(\d+)(?:\/comment\/(\d+))?$/;

export function issueFile(ref: IssueRef): string {
    return ref.commentId === null
        ? `issue#${ref.issue}`
        : `issue#${ref.issue}/comment/${ref.commentId}`;
}

export function parseIssueFile(file: string): IssueRef | null {
    const m = file.match(ISSUE_FILE);
    return m
        ? { issue: Number(m[1]), commentId: m[2] ? Number(m[2]) : null }
        : null;
}

/** An open issue as `gh issue list --json number,state,body,comments` has it. */
export type GhIssue = {
    number: number;
    state: string;
    body: string;
    comments: { url: string; body: string }[];
};

/**
 * The texts of OPEN issues only — closed issues are the historical record,
 * never rewritten and never reported. A comment is addressed by the numeric
 * id at the end of its URL (`#issuecomment-<id>`), which is what the REST
 * edit endpoint takes.
 */
export function issueSources(issues: GhIssue[]): Source[] {
    const out: Source[] = [];
    for (const issue of issues) {
        if (issue.state !== "OPEN") continue;
        out.push({
            file: issueFile({ issue: issue.number, commentId: null }),
            text: issue.body ?? "",
        });
        for (const c of issue.comments ?? []) {
            const id = c.url.match(/#issuecomment-(\d+)$/)?.[1];
            if (!id) continue;
            out.push({
                file: issueFile({ issue: issue.number, commentId: Number(id) }),
                text: c.body ?? "",
            });
        }
    }
    return out;
}

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
const CLAIM_MAX = 2000;
const CLAIM_REACH = 25;

function isProse(file: string): boolean {
    return file.endsWith(".md") || parseIssueFile(file) !== null;
}

/**
 * The claim a citation on 1-based `lineNo` makes: in prose, the table row it
 * sits in or its blank-line-delimited paragraph; in code, the contiguous
 * comment block around it plus the first code line after the block (the
 * comment usually describes that line). Bounded, so a 400-line JSDoc does not
 * become the claim.
 */
export function claimAt(file: string, text: string, lineNo: number): string {
    const lines = text.split("\n");
    const at = lineNo - 1;
    const cur = lines[at] ?? "";
    let from = at;
    let to = at;
    if (isProse(file)) {
        if (!cur.trim().startsWith("|")) {
            const inPara = (l: string | undefined) =>
                l !== undefined && l.trim() !== "" && !l.trim().startsWith("|");
            while (from > at - CLAIM_REACH && inPara(lines[from - 1])) from--;
            while (to < at + CLAIM_REACH && inPara(lines[to + 1])) to++;
        }
    } else {
        const inBlock = (l: string | undefined) =>
            l !== undefined && COMMENT_LINE.test(l);
        while (from > at - CLAIM_REACH && inBlock(lines[from - 1])) from--;
        if (COMMENT_LINE.test(cur)) {
            while (to < at + CLAIM_REACH && inBlock(lines[to + 1])) to++;
            const next = lines[to + 1];
            if (next !== undefined && next.trim() !== "") to++;
        }
    }
    const claim = lines.slice(from, to + 1).join("\n");
    return claim.length > CLAIM_MAX ? clipAround(claim, cur) : claim;
}

function clipAround(claim: string, line: string): string {
    const pos = Math.max(0, claim.indexOf(line));
    const start = Math.max(0, pos - CLAIM_MAX / 2);
    return `…${claim.slice(start, start + CLAIM_MAX)}…`;
}

/**
 * Stage 1. `citations` is EXACTLY what the existence scan returns for these
 * sources — the audit never tokenizes, so it, the ledger and `cr:lint` cannot
 * disagree on the set. `units` are the ledger-accountable citations (exempt
 * files dropped, deduplicated by the ledger's key), each with its claim.
 */
export function collect(
    sources: Source[],
    ids: Set<string>
): { citations: Citation[]; units: AuditUnit[] } {
    const { citations } = scanCitations(sources, ids);
    const texts = new Map(sources.map((s) => [s.file, s.text] as const));
    const units: AuditUnit[] = [];
    for (const cit of treeCitations(citations).values()) {
        const first = cit.sites[0];
        units.push({
            ...cit,
            claim: claimAt(first.file, texts.get(first.file) ?? "", first.line),
        });
    }
    return { citations, units };
}

// ── Assess ─────────────────────────────────────────────────────────────────

export type Verdict = "correct" | "wrong" | "unclear";

export type Assessment = {
    id: string;
    line: string;
    ruleHash: string;
    verdict: Verdict;
    proposedId?: string;
    reason: string;
    model?: string;
};

/** The ledger's entry key plus the printed rule's hash. */
export function cacheKey(id: string, line: string, hash: string): string {
    return `${entryKey(id, line)}\t${hash}`;
}

export function assessmentKey(a: Assessment): string {
    return cacheKey(a.id, a.line, a.ruleHash);
}

export function parentId(id: string): string | null {
    if (/[a-z]$/.test(id)) return id.replace(/[a-z]+$/, "");
    if (id.includes(".")) return id.slice(0, id.indexOf("."));
    return null;
}

export type RuleContext = {
    /** The cited rule itself — its own text, not its descendants. */
    cited: string;
    parent: string | null;
    siblings: Rule[];
    children: Rule[];
};

const SIBLING_MAX = 40;
const RULE_TEXT_MAX = 700;

function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * What the model sees for a cited id: its own text, its parent's, its
 * siblings' (a neighbouring letter is the usual mistake) and — for a section
 * or rule cited as a whole — its direct children, each clipped. Never the
 * whole `printedRule` of a section: `702` alone is hundreds of KB.
 */
export function ruleContext(rules: Rule[], id: string): RuleContext {
    const byId = new Map(rules.map((r) => [r.id, r] as const));
    const parent = parentId(id);
    const siblings = rules.filter(
        (r) => r.id !== id && parent !== null && parentId(r.id) === parent
    );
    const children = rules.filter((r) => parentId(r.id) === id);
    return {
        cited: byId.get(id)?.text ?? "",
        parent: parent === null ? null : (byId.get(parent)?.text ?? null),
        siblings: nearest(siblings, rules, id)
            .slice(0, SIBLING_MAX)
            .map((r) => ({ id: r.id, text: clip(r.text, RULE_TEXT_MAX) })),
        children: children
            .slice(0, SIBLING_MAX)
            .map((r) => ({ id: r.id, text: clip(r.text, RULE_TEXT_MAX) })),
    };
}

/**
 * Document order, but centred on `id` when there are too many to send. The
 * centre is `id`'s POSITION in the document, never a string comparison of
 * ids: "701.9" sorts after "701.66" as a string, so a lexical search sends
 * 701.1–701.40 for a citation of 701.66 — the wrong neighbourhood, in exactly
 * the renumbering sections (701/702) the siblings are there to catch.
 */
function nearest(siblings: Rule[], rules: Rule[], id: string): Rule[] {
    if (siblings.length <= SIBLING_MAX) return siblings;
    const position = new Map(rules.map((r, i) => [r.id, i] as const));
    const own = position.get(id) ?? -1;
    const before = siblings.filter((r) => (position.get(r.id) ?? 0) < own);
    const start = Math.max(
        0,
        Math.min(before.length - SIBLING_MAX / 2, siblings.length - SIBLING_MAX)
    );
    return siblings.slice(start, start + SIBLING_MAX);
}

export type AssessItem = {
    index: number;
    where: string;
    line: string;
    claim: string;
};

export type AssessRequest = {
    id: string;
    context: RuleContext;
    items: AssessItem[];
};

export type AssessResponse = {
    verdicts: {
        index: number;
        verdict: Verdict;
        proposedId: string;
        reason: string;
    }[];
    model?: string;
};

/** The model seam — a scripted fake in the test, the Anthropic SDK live. */
export type AssessClient = (req: AssessRequest) => Promise<AssessResponse>;

export const AUDIT_SYSTEM_PROMPT = `You audit citations of the Magic: The Gathering Comprehensive Rules (CR) in the source code and issue tracker of a rules engine.

For each citation you get the line that cites the rule and the surrounding claim, plus the printed text of the cited rule, its parent rule, its sibling subrules and (for a rule cited as a whole) its direct children.

Decide, for each citation, whether the cited rule says what the claim uses it for:
- "correct": the cited rule (or, for a rule cited as a whole, its subrules) supports the claim. A broad citation of the right section is correct.
- "wrong": the cited rule does not say what the claim relies on, and a different rule does. Give that rule's id in proposedId and, in reason, one sentence quoting the words of the proposed rule that say it. Typical mistakes are a neighbouring subrule letter, a renumbered section, or a rule about a different mechanic.
- "unclear": the claim is too vague to judge, or you cannot name the rule that does say it.

Only propose ids you are confident exist in the current CR. Leave proposedId empty unless the verdict is "wrong". Return exactly one verdict per citation index.`;

/** The user turn for one request — pure, so its shape is testable. */
export function renderPrompt(req: AssessRequest): string {
    const ctx = req.context;
    const rules = [
        `Cited rule CR ${req.id}:\n${ctx.cited}`,
        ctx.parent ? `Parent rule:\n${ctx.parent}` : null,
        ctx.siblings.length
            ? `Sibling rules:\n${ctx.siblings.map((r) => r.text).join("\n")}`
            : null,
        ctx.children.length
            ? `Direct subrules:\n${ctx.children.map((r) => r.text).join("\n")}`
            : null,
    ].filter(Boolean);
    const items = req.items.map(
        (it) =>
            `### Citation ${it.index} (${it.where})\nLine: ${it.line}\nClaim:\n${it.claim}`
    );
    return `${rules.join("\n\n")}\n\n## Citations of CR ${req.id}\n\n${items.join("\n\n")}`;
}

/** Structured-output schema the live client constrains the reply to. */
export const VERDICT_SCHEMA = {
    type: "object",
    properties: {
        verdicts: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    index: { type: "integer" },
                    verdict: {
                        type: "string",
                        enum: ["correct", "wrong", "unclear"],
                    },
                    proposedId: { type: "string" },
                    reason: { type: "string" },
                },
                required: ["index", "verdict", "proposedId", "reason"],
                additionalProperties: false,
            },
        },
    },
    required: ["verdicts"],
    additionalProperties: false,
} as const;

/**
 * One model verdict made safe to cache: a `wrong` must name a DIFFERENT id
 * that resolves in the vendored CR, or it is discarded down to `unclear` with
 * the discarded id named in the reason; a `correct` carries no proposal.
 */
export function settleVerdict(
    unit: { id: string; line: string },
    hash: string,
    v: AssessResponse["verdicts"][number],
    ids: Set<string>,
    model?: string
): Assessment {
    const base = { id: unit.id, line: unit.line, ruleHash: hash, model };
    const proposed = v.proposedId.trim().replace(/^CR\s*/, "");
    if (v.verdict !== "wrong") {
        return { ...base, verdict: v.verdict, reason: v.reason };
    }
    if (!proposed || proposed === unit.id) {
        return {
            ...base,
            verdict: "unclear",
            reason: `wrong without a usable proposal — ${v.reason}`,
        };
    }
    if (!ids.has(proposed)) {
        return {
            ...base,
            verdict: "unclear",
            reason: `proposal CR ${proposed} discarded: it resolves to no rule — ${v.reason}`,
        };
    }
    return {
        ...base,
        verdict: "wrong",
        proposedId: proposed,
        reason: v.reason,
    };
}

export type AssessSummary = {
    assessed: Assessment[];
    cached: number;
    calls: number;
    /** Ids with pending citations left for a later run by `budget`. */
    deferredGroups: number;
    /** Citations of ids that resolve to nothing — `cr:lint`'s job. */
    unresolvable: number;
    /** Citations the model returned no verdict for — re-run to retry. */
    unanswered: number;
    errors: { id: string; message: string }[];
};

const CHUNK = 25;

/**
 * Stage 2. Groups the pending (uncached) units by cited id, assesses at most
 * `budget` groups, and reports each settled batch through `onAssessed` as it
 * lands — so an interrupted run keeps what it paid for.
 */
export async function assess(input: {
    units: AuditUnit[];
    rules: Rule[];
    ids: Set<string>;
    cache: Map<string, Assessment>;
    client: AssessClient;
    budget: number;
    concurrency?: number;
    onAssessed?: (batch: Assessment[]) => void;
}): Promise<AssessSummary> {
    const { units, rules, ids, cache, client } = input;
    const summary: AssessSummary = {
        assessed: [],
        cached: 0,
        calls: 0,
        deferredGroups: 0,
        unresolvable: 0,
        unanswered: 0,
        errors: [],
    };
    const hashOf = new Map<string, string | null>();
    const pending = new Map<string, { unit: AuditUnit; hash: string }[]>();
    for (const unit of units) {
        if (!hashOf.has(unit.id)) {
            const printed = printedRule(rules, unit.id);
            hashOf.set(unit.id, printed === null ? null : ruleHash(printed));
        }
        const hash = hashOf.get(unit.id) ?? null;
        if (hash === null) {
            summary.unresolvable++;
            continue;
        }
        if (cache.has(cacheKey(unit.id, unit.line, hash))) {
            summary.cached++;
            continue;
        }
        const group = pending.get(unit.id) ?? [];
        group.push({ unit, hash });
        pending.set(unit.id, group);
    }
    const groups = [...pending.keys()].sort();
    const chosen = groups.slice(0, Math.max(0, input.budget));
    summary.deferredGroups = groups.length - chosen.length;

    const jobs: (() => Promise<void>)[] = [];
    for (const id of chosen) {
        const context = ruleContext(rules, id);
        const group = pending.get(id) ?? [];
        for (let c = 0; c < group.length; c += CHUNK) {
            const chunk = group.slice(c, c + CHUNK);
            jobs.push(async () => {
                const items = chunk.map(({ unit }, index) => ({
                    index,
                    where: siteLabel(unit.sites),
                    line: unit.line,
                    claim: unit.claim,
                }));
                summary.calls++;
                let res: AssessResponse;
                try {
                    res = await client({ id, context, items });
                } catch (err) {
                    summary.errors.push({
                        id,
                        message:
                            err instanceof Error ? err.message : String(err),
                    });
                    return;
                }
                const batch: Assessment[] = [];
                const seen = new Set<number>();
                for (const v of res.verdicts) {
                    const hit = chunk[v.index];
                    if (!hit || seen.has(v.index)) continue;
                    seen.add(v.index);
                    const a = settleVerdict(
                        hit.unit,
                        hit.hash,
                        v,
                        ids,
                        res.model
                    );
                    cache.set(assessmentKey(a), a);
                    batch.push(a);
                }
                summary.unanswered += chunk.length - seen.size;
                summary.assessed.push(...batch);
                input.onAssessed?.(batch);
            });
        }
    }
    await runPool(jobs, input.concurrency ?? 1);
    return summary;
}

async function runPool(
    jobs: (() => Promise<void>)[],
    concurrency: number
): Promise<void> {
    let next = 0;
    const worker = async () => {
        while (next < jobs.length) await jobs[next++]();
    };
    await Promise.all(
        Array.from({ length: Math.max(1, concurrency) }, () => worker())
    );
}

function siteLabel(sites: Site[]): string {
    const first = `${sites[0].file}:${sites[0].line}`;
    return sites.length > 1 ? `${first} (+${sites.length - 1} more)` : first;
}

/** The cache on disk: JSON Lines, append-only, last line for a key wins. */
export function parseCache(text: string): Map<string, Assessment> {
    const cache = new Map<string, Assessment>();
    for (const raw of text.split("\n")) {
        if (!raw.trim()) continue;
        const a = JSON.parse(raw) as Assessment;
        cache.set(assessmentKey(a), a);
    }
    return cache;
}

export function serializeAssessments(batch: Assessment[]): string {
    return batch.map((a) => `${JSON.stringify(a)}\n`).join("");
}

// ── Report ─────────────────────────────────────────────────────────────────

export type ReviewDecision = "correct" | "fix" | "skip";

/**
 * One reviewable citation. `decision` is null until a reviewer records one;
 * `apply` refuses an entry without it. `fix` rewrites the id to `newId`
 * (default: the model's proposal); `correct` leaves the line as it is. Both
 * promote the line through `cr:ledger confirm` — tree lines only.
 */
export type ReviewEntry = {
    key: string;
    id: string;
    line: string;
    sites: Site[];
    verdict: Verdict;
    proposedId?: string;
    reason: string;
    decision: ReviewDecision | null;
    newId?: string;
};

export type Review = { entries: ReviewEntry[] };

export type AuditReport = {
    counts: Record<Verdict | "pending" | "unresolvable", number>;
    entries: ReviewEntry[];
};

export function buildReport(
    units: AuditUnit[],
    rules: Rule[],
    cache: Map<string, Assessment>
): AuditReport {
    const counts = {
        correct: 0,
        wrong: 0,
        unclear: 0,
        pending: 0,
        unresolvable: 0,
    };
    const entries: ReviewEntry[] = [];
    for (const unit of units) {
        const printed = printedRule(rules, unit.id);
        if (printed === null) {
            counts.unresolvable++;
            continue;
        }
        const key = cacheKey(unit.id, unit.line, ruleHash(printed));
        const a = cache.get(key);
        if (!a) {
            counts.pending++;
            continue;
        }
        counts[a.verdict]++;
        entries.push({
            key,
            id: unit.id,
            line: unit.line,
            sites: unit.sites,
            verdict: a.verdict,
            ...(a.proposedId ? { proposedId: a.proposedId } : {}),
            reason: a.reason,
            decision: null,
        });
    }
    return { counts, entries };
}

/**
 * Carries a reviewer's decisions over a regenerated report: same key, same
 * decision. A decision on a key the new report no longer has is dropped —
 * the line changed, and what was reviewed is not what is there.
 */
export function mergeReview(
    fresh: ReviewEntry[],
    prior: Review | null
): Review {
    const decided = new Map(
        (prior?.entries ?? []).map((e) => [e.key, e] as const)
    );
    return {
        entries: fresh.map((e) => {
            const old = decided.get(e.key);
            return old && old.decision !== null
                ? {
                      ...e,
                      decision: old.decision,
                      ...(old.newId ? { newId: old.newId } : {}),
                  }
                : e;
        }),
    };
}

function groupOf(site: Site): string {
    const ref = parseIssueFile(site.file);
    if (ref) return `issue #${ref.issue}`;
    const slash = site.file.lastIndexOf("/");
    return slash < 0 ? "." : site.file.slice(0, slash);
}

function quote(text: string | null, max = 900): string {
    return (text ?? "(resolves to nothing)")
        .split("\n")
        .map((l) => `> ${clip(l, max)}`)
        .join("\n");
}

/**
 * The human report: every `wrong` and `unclear`, grouped by directory for the
 * tree and by issue for GitHub, each with the line, the cited rule and the
 * proposed rule side by side.
 */
export function formatReport(report: AuditReport, rules: Rule[]): string {
    const c = report.counts;
    const out = [
        `# cr:audit report`,
        "",
        `correct ${c.correct} · wrong ${c.wrong} · unclear ${c.unclear} · pending ${c.pending} · unresolvable ${c.unresolvable}`,
        "",
    ];
    const groups = new Map<string, { e: ReviewEntry; sites: Site[] }[]>();
    for (const e of report.entries) {
        if (e.verdict === "correct") continue;
        const bySite = new Map<string, Site[]>();
        for (const s of e.sites) {
            const g = groupOf(s);
            bySite.set(g, [...(bySite.get(g) ?? []), s]);
        }
        for (const [g, sites] of bySite)
            groups.set(g, [...(groups.get(g) ?? []), { e, sites }]);
    }
    const order = [...groups.keys()].sort((a, b) => {
        const ia = a.startsWith("issue #");
        const ib = b.startsWith("issue #");
        if (ia !== ib) return ia ? 1 : -1;
        return ia
            ? Number(a.slice(7)) - Number(b.slice(7))
            : a.localeCompare(b);
    });
    for (const g of order) {
        out.push(`## ${g}`, "");
        for (const { e, sites } of groups.get(g) ?? []) {
            out.push(
                `### ${e.verdict.toUpperCase()} — CR ${e.id}${e.proposedId ? ` → CR ${e.proposedId}` : ""}`,
                "",
                sites.map((s) => `- \`${s.file}:${s.line}\``).join("\n"),
                "",
                "```",
                e.line,
                "```",
                "",
                `Reason: ${e.reason}`,
                "",
                `Cited — CR ${e.id}:`,
                quote(printedRuleOwn(rules, e.id)),
                ""
            );
            if (e.proposedId)
                out.push(
                    `Proposed — CR ${e.proposedId}:`,
                    quote(printedRuleOwn(rules, e.proposedId)),
                    ""
                );
        }
    }
    return out.join("\n");
}

/** A rule's own text (never a section's whole subtree), for the report. */
function printedRuleOwn(rules: Rule[], id: string): string | null {
    return rules.find((r) => r.id === id)?.text ?? null;
}

// ── Apply ──────────────────────────────────────────────────────────────────

/** The one IO surface `apply` has — injectable, so the test never writes. */
export type ApplyIO = {
    readTree(file: string): string;
    writeTree(file: string, text: string): void;
    /** `bun run cr:ledger confirm <file>:<line>` — the ledger's own writer. */
    confirmTreeLine(file: string, line: number): void;
    fetchIssueText(ref: IssueRef): Promise<{ state: string; text: string }>;
    writeIssueText(ref: IssueRef, text: string): Promise<void>;
    /** Whether the user explicitly confirmed writing this issue. */
    issueConfirmed(issue: number): boolean;
    log(message: string): void;
};

export type ApplySummary = {
    unreviewed: number;
    refused: { key: string; site?: string; why: string }[];
    rewritten: string[];
    confirmed: string[];
    unconfirmed: { site: string; why: string }[];
    issuesWritten: string[];
    issuesAwaitingConfirmation: string[];
};

/** Replaces the one token `from` on a line; null when it is not exactly one. */
export function replaceId(
    raw: string,
    from: string,
    to: string
): string | null {
    const token = new RegExp(
        // Not a digit or letter after, nor `.<digit>` — `111` must not match
        // the prefix of `111.10` — but a sentence-ending `111.` still does.
        `(?<![\\d.])${from.replace(/\./g, "\\.")}(?![\\da-z]|\\.\\d)`,
        "g"
    );
    const hits = raw.match(token)?.length ?? 0;
    return hits === 1 ? raw.replace(token, to) : null;
}

/**
 * Stage 3. Applies ONLY reviewed entries: `decision: null` is refused and
 * touches nothing. A site whose line no longer normalizes to the reviewed
 * line is refused (what was reviewed is not what is there). Tree fixes are
 * written, then every touched line is confirmed through the ledger's command
 * — but only when EVERY citation on it was reviewed in this batch, since
 * `confirm` records the whole line. Issue edits are shown as a diff and
 * written only for issues the user confirmed, and only while still open.
 */
export async function applyReview(
    review: Review,
    ids: Set<string>,
    io: ApplyIO
): Promise<ApplySummary> {
    const s: ApplySummary = {
        unreviewed: 0,
        refused: [],
        rewritten: [],
        confirmed: [],
        unconfirmed: [],
        issuesWritten: [],
        issuesAwaitingConfirmation: [],
    };
    type Edit = { e: ReviewEntry; site: Site; to: string };
    const treeEdits = new Map<string, Edit[]>();
    const issueEdits = new Map<string, Edit[]>();
    for (const e of review.entries) {
        if (e.decision === null) {
            s.unreviewed++;
            continue;
        }
        if (e.decision === "skip") continue;
        const to = e.decision === "fix" ? (e.newId ?? e.proposedId) : e.id;
        if (!to || !ids.has(to) || (e.decision === "fix" && to === e.id)) {
            s.refused.push({
                key: e.key,
                why: `fix target ${to ? `CR ${to}` : "(none)"} is not a different rule that resolves`,
            });
            continue;
        }
        for (const site of e.sites) {
            const bucket = parseIssueFile(site.file) ? issueEdits : treeEdits;
            bucket.set(site.file, [
                ...(bucket.get(site.file) ?? []),
                { e, site, to },
            ]);
        }
    }

    for (const [file, edits] of treeEdits) {
        if (isExempt(file)) continue;
        const lines = io.readTree(file).split("\n");
        const touched = new Map<number, Set<string>>();
        for (const { e, site, to } of edits) {
            const label = `${file}:${site.line}`;
            const raw = lines[site.line - 1];
            if (raw === undefined || normalizeLine(raw) !== e.line) {
                s.refused.push({
                    key: e.key,
                    site: label,
                    why: "line changed since review",
                });
                continue;
            }
            if (to !== e.id) {
                const next = replaceId(raw, e.id, to);
                if (next === null) {
                    s.refused.push({
                        key: e.key,
                        site: label,
                        why: `CR ${e.id} is not exactly one token on the line`,
                    });
                    continue;
                }
                lines[site.line - 1] = next;
                s.rewritten.push(`${label}  CR ${e.id} → CR ${to}`);
            }
            touched.set(
                site.line,
                (touched.get(site.line) ?? new Set()).add(to)
            );
        }
        const text = lines.join("\n");
        if (s.rewritten.some((r) => r.startsWith(`${file}:`)))
            io.writeTree(file, text);
        const scanned = scanCitations([{ file, text }], ids).citations;
        for (const [line, reviewed] of touched) {
            const onLine = scanned
                .filter((c) => c.line === line)
                .map((c) => c.id);
            const open = onLine.filter((id) => !reviewed.has(id));
            const label = `${file}:${line}`;
            if (open.length) {
                s.unconfirmed.push({
                    site: label,
                    why: `also cites ${[...new Set(open)].map((id) => `CR ${id}`).join(", ")}, not reviewed`,
                });
                continue;
            }
            io.confirmTreeLine(file, line);
            s.confirmed.push(label);
        }
    }

    for (const [file, edits] of issueEdits) {
        const ref = parseIssueFile(file) as IssueRef;
        const current = await io.fetchIssueText(ref);
        if (current.state !== "OPEN") {
            s.refused.push({
                key: edits[0].e.key,
                site: file,
                why: `issue #${ref.issue} is ${current.state.toLowerCase()} — closed issues are never written`,
            });
            continue;
        }
        const lines = current.text.split("\n");
        const diff: string[] = [];
        for (const { e, site, to } of edits) {
            if (to === e.id) continue;
            const raw = lines[site.line - 1];
            const next =
                raw !== undefined && normalizeLine(raw) === e.line
                    ? replaceId(raw, e.id, to)
                    : null;
            if (next === null) {
                s.refused.push({
                    key: e.key,
                    site: `${file}:${site.line}`,
                    why: "line changed since review, or the id is not exactly one token",
                });
                continue;
            }
            diff.push(`@@ ${file}:${site.line}`, `- ${raw}`, `+ ${next}`);
            lines[site.line - 1] = next;
        }
        if (!diff.length) continue;
        io.log(diff.join("\n"));
        if (!io.issueConfirmed(ref.issue)) {
            s.issuesAwaitingConfirmation.push(file);
            continue;
        }
        await io.writeIssueText(ref, lines.join("\n"));
        s.issuesWritten.push(file);
    }
    return s;
}
