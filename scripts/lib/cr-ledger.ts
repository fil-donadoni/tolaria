/**
 * The CR citation ledger (ADR 0133, issue #3674) — pure over its inputs.
 *
 * `check-cr-citations.ts` proves a cited id EXISTS; the keyword scan and the
 * targeted scans prove, for a few known shapes, that it means what the line
 * says. Everything outside those shapes — a RESOLVABLE BUT WRONG id — passed
 * the gate clean, and the findings drawer shows that is a class, not an
 * incident (`707.10b` for retargeting a copy at 36 sites, `616.1c`/`616.1d`
 * for once-per-event and choose-the-order at ten, `702.35c`, `704.5m`, …).
 * Every one was found by a human printing the rule; one targeted scanner per
 * shape only guards shapes already discovered.
 *
 * The ledger turns "someone printed the rule and checked the line" into a
 * committed fact the offline gate can enforce. One entry per citation:
 *
 *   - `id`      — the cited rule id;
 *   - `line`    — the NORMALIZED text of the line citing it (whitespace
 *                 collapsed, trimmed). Never a file or a line number: moving
 *                 the comment keeps its entry, EDITING it reopens the citation
 *                 — on purpose, because the claim is what was checked;
 *   - `sites`   — how many places in the tree make this exact citation. A
 *                 line copied to one more file is one more site: it enters
 *                 the tree as unrecorded until confirmed, so an existing entry
 *                 cannot be used as cover for a new, unchecked site (review of
 *                 PR #3694, finding 2). Fewer sites is a stale count `prune`
 *                 re-syncs;
 *   - `status`  — `confirmed` (a reader printed the rule with `bun run cr <id>`
 *                 and the line says what the rule says) or `baseline` (the
 *                 citation predates the ledger and was never checked);
 *   - `ruleHash` — `confirmed` only: the fingerprint of the printed rule text
 *                 at confirmation, so a `cr:sync` that rewrites the rule
 *                 reopens every citation of it (the next renumbering outside
 *                 701/702 included).
 *
 * The gate (`bun run cr:lint`, and the regression test under `bun run test`)
 * reds on four things, each a `LedgerReport` field:
 *
 *   - `unrecorded` — a citation in the tree with no entry (a new comment, or an
 *     edited line), or with more sites than its entry records. The message
 *     names the line, prints the cited rule and says how to confirm;
 *   - `drifted`    — a `confirmed` entry whose rule text no longer hashes to
 *     what was confirmed;
 *   - `grown`      — a `baseline` entry the base branch's ledger does not have.
 *     The baseline may only SHRINK: nothing enters unchecked under that
 *     status, and the recording command never writes it;
 *   - `stale`      — an entry matching no line in the tree, or recording more
 *     sites than the tree has. The recording command prunes these on every
 *     write, so a committed ledger that carries one was edited by something
 *     else — a red, not noise, because a stale entry is exactly the shape a
 *     hand-added "confirmation" of a line that no longer exists would take.
 *
 * What counts as a citation is the existence scan's own walk
 * (`scanCitations` in `check-cr-citations.ts`) — this module never tokenizes,
 * so the two scans cannot disagree on the set. The `EXEMPT` files need no
 * entry. The `cr-cite-ok` hatch of the targeted scans is deliberately NOT
 * honoured here: those scans ask "is this claim wrong", and a deliberate
 * counter-example answers it; the ledger asks "was this line read", to which
 * a counter-example is still a line — and an unbounded suppression on a gate
 * this heavy is a hatch every session would reach for (review of PR #3694,
 * finding 1). No suppressed citation outside the exempt files existed when
 * this was decided.
 *
 * Shape of the committed file: one entry per line, sorted by id then line,
 * fixed key order, no header hash or tally — so two branches confirming two
 * different citations touch disjoint lines and git merges them (the
 * `generated-artifacts.ts` discriminator: no whole-file state).
 */
import { printedRule, ruleHash, type Rule } from "./cr-rules.ts";

export const LEDGER_PATH = "data/cr/citations-ledger.json";
export const LEDGER_GENERATOR = "bun run cr:ledger";

/**
 * Files whose CR citations need no ledger entry: the citation guards' own
 * sources and tests (their headers and fixtures quote wrong citations on
 * purpose), the findings drawer (it exists to describe defects, not commit
 * them), and the two ADRs that discuss mis-citations by example. Listed one
 * by one, never as an open prefix — a future guard that needs the exemption
 * adds its row here, as a decision.
 */
export const EXEMPT = [
    "docs/findings/",
    "docs/adr/0098-vendored-official-comprehensive-rules.md",
    "docs/adr/0133-cr-citations-carry-a-committed-ledger.md",
    "scripts/cr.ts",
    "scripts/cr-ledger.ts",
    "scripts/cr-keyword-citations.ts",
    "scripts/cr-118-4-life-payment.ts",
    "scripts/cr-616-1-subrule-citations.ts",
    "scripts/check-cr-citations.ts",
    "scripts/lib/cr-ledger.ts",
    "scripts/lib/cr-rules.ts",
    "scripts/lib/cr-misattribution.ts",
    "scripts/__tests__/cr-citations.test.ts",
    "scripts/__tests__/cr-citation-ledger.test.ts",
    "scripts/__tests__/cr-keyword-citations.test.ts",
    "scripts/__tests__/cr-118-4-life-payment.test.ts",
    "scripts/__tests__/cr-616-1-subrule-citations.test.ts",
    "scripts/__tests__/cr-source.test.ts",
];

export type LedgerStatus = "baseline" | "confirmed";

export type LedgerEntry = {
    id: string;
    line: string;
    sites: number;
    status: LedgerStatus;
    ruleHash?: string;
};

export type Ledger = { generator: string; entries: LedgerEntry[] };

/** One citation the existence scan saw: where, which id, the raw line. */
export type Citation = { file: string; line: number; id: string; text: string };

export type Site = { file: string; line: number };

/** A citation the tree makes, deduplicated by (id, normalized line). */
export type TreeCitation = { id: string; line: string; sites: Site[] };

/** A citation the gate wants confirmed, with the rule text a reader checks. */
export type OpenCitation = TreeCitation & {
    reason: "unrecorded" | "new-sites" | "drifted";
    /** What `bun run cr <id>` prints, or `null` if the id resolves to nothing. */
    printed: string | null;
    /** `new-sites`: how many sites the entry records. */
    recordedSites?: number;
};

export type LedgerReport = {
    unrecorded: OpenCitation[];
    drifted: OpenCitation[];
    grown: LedgerEntry[];
    stale: LedgerEntry[];
    /** Citations in the tree the ledger records and accepts. */
    recorded: number;
    /** Whether the only-shrinks check had a base ledger to compare with. */
    baselineChecked: boolean;
};

/** Whitespace collapsed and trimmed — indentation and reflow do not reopen. */
export function normalizeLine(raw: string): string {
    return raw.replace(/\s+/g, " ").trim();
}

export function entryKey(id: string, line: string): string {
    return `${id}\t${line}`;
}

export function isExempt(file: string): boolean {
    return EXEMPT.some((p) =>
        p.endsWith("/") ? file.startsWith(p) : file === p
    );
}

/**
 * The citations the ledger is accountable for: the scan's list minus exempt
 * files, keyed by (id, normalized line) with every site that makes the
 * citation.
 */
export function treeCitations(
    citations: Iterable<Citation>
): Map<string, TreeCitation> {
    const out = new Map<string, TreeCitation>();
    for (const c of citations) {
        if (isExempt(c.file)) continue;
        const line = normalizeLine(c.text);
        const key = entryKey(c.id, line);
        const seen = out.get(key);
        if (seen) seen.sites.push({ file: c.file, line: c.line });
        else
            out.set(key, {
                id: c.id,
                line,
                sites: [{ file: c.file, line: c.line }],
            });
    }
    return out;
}

export function emptyLedger(): Ledger {
    return { generator: LEDGER_GENERATOR, entries: [] };
}

const RULE_ID = /^\d{3}(?:\.\d+[a-z]{0,2})?$/;
const HASH = /^[0-9a-f]{16}$/;

/**
 * Strict: a ledger that does not parse is a red, never an empty ledger — the
 * file is the guard's memory, and a corrupted memory that reads as "nothing
 * confirmed, nothing baseline" would red every citation in the tree at once
 * while hiding the actual problem.
 */
export function parseLedger(text: string): Ledger {
    const parsed = JSON.parse(text) as Partial<Ledger>;
    if (!Array.isArray(parsed.entries)) {
        throw new Error(
            `${LEDGER_PATH}: no \`entries\` array — the file is not a citation ledger`
        );
    }
    const keys = new Set<string>();
    parsed.entries.forEach((e, i) => {
        const where = `${LEDGER_PATH}: entry ${i + 1}`;
        if (typeof e.id !== "string" || !RULE_ID.test(e.id))
            throw new Error(`${where}: \`id\` is not a CR rule id`);
        if (typeof e.line !== "string" || e.line !== normalizeLine(e.line))
            throw new Error(`${where}: \`line\` is not a normalized line`);
        if (!Number.isInteger(e.sites) || (e.sites as number) < 1)
            throw new Error(
                `${where}: \`sites\` is the number of places making this citation, a positive integer`
            );
        if (e.status !== "baseline" && e.status !== "confirmed")
            throw new Error(
                `${where}: \`status\` must be "baseline" or "confirmed"`
            );
        if (e.status === "confirmed" && !HASH.test(e.ruleHash ?? ""))
            throw new Error(
                `${where}: a confirmed entry carries a 16-hex \`ruleHash\` of the printed rule`
            );
        if (e.status === "baseline" && e.ruleHash !== undefined)
            throw new Error(
                `${where}: a baseline entry carries no \`ruleHash\` — nothing was checked`
            );
        const key = entryKey(e.id, e.line);
        if (keys.has(key))
            throw new Error(`${where}: duplicate of an earlier entry`);
        keys.add(key);
    });
    return {
        generator:
            typeof parsed.generator === "string"
                ? parsed.generator
                : LEDGER_GENERATOR,
        entries: parsed.entries as LedgerEntry[],
    };
}

/**
 * Deterministic serializer: one entry per line, sorted by id then line, fixed
 * key order — so a confirmation is one changed line in review and two
 * branches confirming different citations merge without a conflict.
 */
export function serializeLedger(ledger: Ledger): string {
    const rows = [...ledger.entries]
        .sort((a, b) => compare(a.id, b.id) || compare(a.line, b.line))
        .map((e) =>
            JSON.stringify({
                id: e.id,
                line: e.line,
                sites: e.sites,
                status: e.status,
                ...(e.ruleHash === undefined ? {} : { ruleHash: e.ruleHash }),
            })
        );
    const lines = ["{"];
    lines.push(`    "generator": ${JSON.stringify(ledger.generator)},`);
    lines.push(`    "entries": [`);
    rows.forEach((row, i) => {
        lines.push(`        ${row}${i === rows.length - 1 ? "" : ","}`);
    });
    lines.push(`    ]`);
    lines.push("}");
    return lines.join("\n") + "\n";
}

function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

export function baselineKeys(ledger: Ledger): Set<string> {
    return new Set(
        ledger.entries
            .filter((e) => e.status === "baseline")
            .map((e) => entryKey(e.id, e.line))
    );
}

/**
 * The gate's verdict. `baseBaselineKeys` is the base branch's baseline set,
 * or `null` when no base ledger could be read (the caller decides whether
 * that is a skip or a red — see `base-artifact.ts`).
 */
export function ledgerReport(input: {
    citations: Iterable<Citation>;
    ledger: Ledger;
    rules: Rule[];
    baseBaselineKeys: Set<string> | null;
}): LedgerReport {
    const tree = treeCitations(input.citations);
    const byKey = new Map(
        input.ledger.entries.map((e) => [entryKey(e.id, e.line), e] as const)
    );
    const report: LedgerReport = {
        unrecorded: [],
        drifted: [],
        grown: [],
        stale: [],
        recorded: 0,
        baselineChecked: input.baseBaselineKeys !== null,
    };
    const printedCache = new Map<string, string | null>();
    const printed = (id: string): string | null => {
        if (!printedCache.has(id))
            printedCache.set(id, printedRule(input.rules, id));
        return printedCache.get(id) ?? null;
    };
    for (const [key, cit] of tree) {
        const entry = byKey.get(key);
        if (!entry) {
            report.unrecorded.push({
                ...cit,
                reason: "unrecorded",
                printed: printed(cit.id),
            });
            continue;
        }
        if (cit.sites.length > entry.sites) {
            report.unrecorded.push({
                ...cit,
                reason: "new-sites",
                printed: printed(cit.id),
                recordedSites: entry.sites,
            });
            continue;
        }
        if (entry.status === "confirmed") {
            const text = printed(cit.id);
            if (text === null || ruleHash(text) !== entry.ruleHash) {
                report.drifted.push({
                    ...cit,
                    reason: "drifted",
                    printed: text,
                });
                continue;
            }
        }
        report.recorded++;
    }
    for (const [key, entry] of byKey) {
        const cit = tree.get(key);
        if (!cit || cit.sites.length < entry.sites) report.stale.push(entry);
        else if (
            entry.status === "baseline" &&
            input.baseBaselineKeys !== null &&
            !input.baseBaselineKeys.has(key)
        )
            report.grown.push(entry);
    }
    const bySite = (a: OpenCitation, b: OpenCitation) =>
        compare(a.sites[0].file, b.sites[0].file) ||
        a.sites[0].line - b.sites[0].line;
    report.unrecorded.sort(bySite);
    report.drifted.sort(bySite);
    return report;
}

export function reportIsClean(report: LedgerReport): boolean {
    return (
        !report.unrecorded.length &&
        !report.drifted.length &&
        !report.grown.length &&
        !report.stale.length
    );
}

/** The ledger a tree gets on the day the guard is switched on: every citation
 *  it makes, recorded as `baseline` — never checked, and never allowed to grow. */
export function initialLedger(citations: Iterable<Citation>): Ledger {
    return {
        generator: LEDGER_GENERATOR,
        entries: [...treeCitations(citations).values()].map((c) => ({
            id: c.id,
            line: c.line,
            sites: c.sites.length,
            status: "baseline",
        })),
    };
}

/**
 * Records the citations on ONE line as confirmed. `lineCitations` is that
 * line's scan output — every id it cites, the rule text of each having been
 * printed to the reader by the caller; `treeCitationList` is the whole tree's,
 * from which the entry's site count is taken (the claim is the line text, so
 * a confirmation covers every place that makes it). Upserts, so a
 * re-confirmation after a rule change replaces the stale hash. Throws on an
 * id that resolves to nothing: there is no rule text to have checked.
 */
export function confirmLine(
    ledger: Ledger,
    lineCitations: Citation[],
    rules: Rule[],
    treeCitationList: Iterable<Citation>
): { ledger: Ledger; confirmed: LedgerEntry[] } {
    const confirmed: LedgerEntry[] = [];
    const tree = treeCitations(treeCitationList);
    const byKey = new Map(
        ledger.entries.map((e, i) => [entryKey(e.id, e.line), i] as const)
    );
    const entries = [...ledger.entries];
    for (const cit of treeCitations(lineCitations).values()) {
        const text = printedRule(rules, cit.id);
        if (text === null)
            throw new Error(
                `CR ${cit.id} resolves to no rule in the vendored document — nothing to confirm against`
            );
        const key = entryKey(cit.id, cit.line);
        const entry: LedgerEntry = {
            id: cit.id,
            line: cit.line,
            sites: tree.get(key)?.sites.length ?? cit.sites.length,
            status: "confirmed",
            ruleHash: ruleHash(text),
        };
        const at = byKey.get(key);
        if (at !== undefined) entries[at] = entry;
        else entries.push(entry);
        confirmed.push(entry);
    }
    return { ledger: { ...ledger, entries }, confirmed };
}

/**
 * Drops every entry no line in the tree makes any more, and lowers a site
 * count the tree no longer reaches. Never raises one — a new site is
 * confirmed, not pruned into.
 */
export function pruneStale(
    ledger: Ledger,
    citations: Iterable<Citation>
): { ledger: Ledger; pruned: LedgerEntry[] } {
    const tree = treeCitations(citations);
    const pruned: LedgerEntry[] = [];
    const entries: LedgerEntry[] = [];
    for (const e of ledger.entries) {
        const cit = tree.get(entryKey(e.id, e.line));
        if (!cit) {
            pruned.push(e);
            continue;
        }
        if (cit.sites.length < e.sites) {
            pruned.push(e);
            entries.push({ ...e, sites: cit.sites.length });
            continue;
        }
        entries.push(e);
    }
    return { ledger: { ...ledger, entries }, pruned };
}

/** The first `max` characters of a printed rule, for a report line. */
export function excerpt(printed: string | null, max = 400): string {
    if (printed === null) return "(no such rule in the vendored CR)";
    const flat = printed.replace(/\s*\n\s*/g, " ⏎ ");
    return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function siteLabel(sites: Site[]): string {
    const first = `${sites[0].file}:${sites[0].line}`;
    return sites.length > 1 ? `${first} (+${sites.length - 1} more)` : first;
}

function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * One open citation, formatted for the gate and the recording command. The
 * gate clips the line and the rule; the recording command's listing IS the
 * reading a confirmation asserts, so it passes `Infinity` for both.
 */
export function formatOpen(
    open: OpenCitation,
    ruleChars = 400,
    lineChars = 200
): string {
    const why =
        open.reason === "unrecorded"
            ? "no ledger entry"
            : open.reason === "new-sites"
              ? `${open.sites.length - (open.recordedSites ?? 0)} new site(s) of a recorded line (${open.recordedSites} recorded)`
              : "rule text changed since it was confirmed";
    return (
        `  ${siteLabel(open.sites)}  CR ${open.id} — ${why}\n` +
        `      ${clip(open.line, lineChars)}\n` +
        `      ┃ ${excerpt(open.printed, ruleChars)}`
    );
}

/**
 * The whole workflow for a session that added a CR comment, in the failure
 * output: what to read, what "confirmed" asserts, which command records it.
 */
export const CONFIRM_ADVICE =
    `Read each rule above against its line. If the line says what the rule says, record it:\n` +
    `  bun run cr:ledger confirm <file>:<line>    # ONE line per call; "confirmed" asserts a reader\n` +
    `                                             # printed CR <id> and the line's claim matches its text\n` +
    `If it does not, fix the citation on its line first, then confirm it under the right id.\n` +
    `\`bun run cr:ledger\` lists every open citation with its rule; \`bun run cr:ledger prune\` drops stale entries.`;

/** The gate's report — every problem class, capped, with the advice. */
export function formatReport(report: LedgerReport, showFiles: boolean): string {
    const cap = <T>(items: T[]): T[] =>
        showFiles ? items : items.slice(0, 25);
    const more = (n: number) =>
        !showFiles && n > 25
            ? `  … ${n - 25} more (re-run with --files)\n`
            : "";
    const out: string[] = [];
    if (report.unrecorded.length) {
        out.push(
            `\n${report.unrecorded.length} CR citation(s) have no ledger entry (ADR 0133 — a citation is confirmed against the printed rule, never assumed):\n`
        );
        out.push(
            cap(report.unrecorded)
                .map((o) => formatOpen(o))
                .join("\n")
        );
        out.push(more(report.unrecorded.length));
    }
    if (report.drifted.length) {
        out.push(
            `\n${report.drifted.length} confirmed citation(s) cite a rule whose text changed since confirmation (re-read, then re-confirm):\n`
        );
        out.push(
            cap(report.drifted)
                .map((o) => formatOpen(o))
                .join("\n")
        );
        out.push(more(report.drifted.length));
    }
    if (report.grown.length) {
        out.push(
            `\n${report.grown.length} \`baseline\` entr${report.grown.length === 1 ? "y" : "ies"} the base branch's ledger does not have — the baseline only shrinks (nothing enters unchecked):\n`
        );
        out.push(
            cap(report.grown)
                .map((e) => `  CR ${e.id}  ${clip(e.line, 160)}`)
                .join("\n")
        );
        out.push(more(report.grown.length));
        out.push(
            `  Delete the entry and confirm the line instead (\`bun run cr:ledger confirm <file>:<line>\`).`
        );
    }
    if (report.stale.length) {
        out.push(
            `\n${report.stale.length} ledger entr${report.stale.length === 1 ? "y matches" : "ies match"} no line in the tree, or more sites than the tree has (edited or removed without recording):\n`
        );
        out.push(
            cap(report.stale)
                .map((e) => `  CR ${e.id}  ${clip(e.line, 160)}`)
                .join("\n")
        );
        out.push(more(report.stale.length));
        out.push(`  Run \`bun run cr:ledger prune\`.`);
    }
    if (report.unrecorded.length || report.drifted.length)
        out.push(`\n${CONFIRM_ADVICE}`);
    return out.join("\n");
}
