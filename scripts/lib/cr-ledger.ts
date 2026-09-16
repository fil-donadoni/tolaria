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
 *   - `line`    — the NORMALIZED text of the PHYSICAL line the id sits on
 *                 (whitespace collapsed, trimmed) — for a citation wrapped
 *                 across two comment lines (`cr-lines.ts`, issue #2514), the
 *                 line carrying the id, not the joined text the scans read.
 *                 Never a file or a line number: moving the comment keeps its
 *                 entry, EDITING it reopens the citation — on purpose, because
 *                 the claim is what was checked. For a wrapped citation that
 *                 guarantee covers the id's line only: rewriting the OTHER
 *                 half of the sentence changes no key (keying on the joined
 *                 text would re-key every wrapped entry, which `wideningOf`
 *                 refuses), so a confirmation of a wrapped line is a reader's
 *                 word for both halves;
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
 *     The baseline SHRINKS by default: nothing enters unchecked under that
 *     status, and `confirm` never writes it. The one licensed growth is a
 *     TOKENIZER WIDENING (issue #3697): when the diff changes what counts as
 *     a citation, the citations the new tokenizer sees on the MERGE-BASE tree
 *     that the merge-base ledger lacks are what the widening uncovered — they
 *     predate the branch and were invisible, not unchecked. `cr:ledger widen`
 *     records exactly that set as `baseline`, and the report accepts a grown
 *     entry only if it is in it (`widened`). A line the branch edited has a
 *     new key the merge-base tree does not make, so it is never in the set;
 *     a citation the merge-base ledger already recorded is never in it
 *     either, whatever its status — a widening cannot re-baseline, and
 *     cannot turn a `confirmed` entry back;
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
    "scripts/cr-audit.ts",
    "scripts/cr-keyword-citations.ts",
    "scripts/cr-118-4-life-payment.ts",
    "scripts/cr-616-1-subrule-citations.ts",
    "scripts/check-cr-citations.ts",
    "scripts/lib/cr-ledger.ts",
    "scripts/lib/cr-rules.ts",
    "scripts/lib/cr-lines.ts",
    "scripts/lib/cr-misattribution.ts",
    "scripts/lib/cr-audit.ts",
    "scripts/__tests__/cr-audit.test.ts",
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
    /** `baseline` entries the base lacks that a tokenizer widening licensed. */
    widened: number;
};

/**
 * A tokenizer widening (issue #3697): the citations the CURRENT tokenizer
 * makes of the MERGE-BASE tree that the merge-base ledger does not record,
 * keyed like the ledger. Every one predates the branch and was invisible to
 * the tokenizer the merge-base ledger was kept with — the only reason it can
 * have no entry is that the tokenizer changed.
 */
export type Widening = Map<string, TreeCitation>;

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

/** The `baseline` entries of a ledger, key → recorded site count. */
export function baselineSites(ledger: Ledger): Map<string, number> {
    return new Map(
        ledger.entries
            .filter((e) => e.status === "baseline")
            .map((e) => [entryKey(e.id, e.line), e.sites] as const)
    );
}

/**
 * The gate's verdict. `baseBaseline` is the base branch's baseline set with
 * each entry's site count, or `null` when no base ledger could be read (the
 * caller decides whether that is a skip or a red — see `base-artifact.ts`).
 * `widened` is the tokenizer widening the diff carries (`wideningOf`), or
 * `null` when the diff carries none. A `baseline` entry is `grown` unless the
 * base has it with at least as many sites, or the widening uncovered it with
 * at least as many sites — the count is part of the licence both ways, since
 * a raised count is one more unchecked site under a recorded key (the hole
 * `sites` exists to close, review of PR #3694, finding 2).
 */
export function ledgerReport(input: {
    citations: Iterable<Citation>;
    ledger: Ledger;
    rules: Rule[];
    baseBaseline: Map<string, number> | null;
    widened: Widening | null;
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
        baselineChecked: input.baseBaseline !== null,
        widened: 0,
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
        else if (entry.status === "baseline" && input.baseBaseline !== null) {
            const baseSites = input.baseBaseline.get(key);
            if (baseSites !== undefined && entry.sites <= baseSites) continue;
            const uncovered =
                baseSites === undefined ? input.widened?.get(key) : undefined;
            if (uncovered && entry.sites <= uncovered.sites.length)
                report.widened++;
            else report.grown.push(entry);
        }
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
 * What a tokenizer widening uncovered (issue #3697): `beforeCitations` is the
 * CURRENT tokenizer's walk of the MERGE-BASE tree, `baseLedger` the ledger
 * that tree was committed with. Every citation of the former the latter does
 * not record — under ANY status — is one the old tokenizer could not see,
 * because the tree is the same tree its ledger was kept green against. Keyed
 * like the ledger; the site count is the merge-base tree's.
 *
 * `lost` is the converse, and it is what keeps "widen" from meaning
 * "regenerate": a merge-base entry the current tokenizer no longer makes of
 * the merge-base tree (or makes at fewer sites) says the change did not
 * WIDEN what a citation is — it narrowed or RE-KEYED it (a `normalizeLine`
 * or `EXEMPT` change re-keys the whole tree, so `uncovered` would be every
 * citation there). A widening is a superset of what it replaces; anything
 * else has no licence, and the command refuses it (review of this PR,
 * finding 1).
 */
export function wideningOf(
    beforeCitations: Iterable<Citation>,
    baseLedger: Ledger
): { uncovered: Widening; lost: LedgerEntry[] } {
    const before = treeCitations(beforeCitations);
    const recorded = new Set<string>();
    const lost: LedgerEntry[] = [];
    for (const e of baseLedger.entries) {
        const key = entryKey(e.id, e.line);
        recorded.add(key);
        const now = before.get(key);
        if (!now || now.sites.length < e.sites) lost.push(e);
    }
    const uncovered: Widening = new Map();
    for (const [key, cit] of before)
        if (!recorded.has(key)) uncovered.set(key, cit);
    return { uncovered, lost };
}

/**
 * Enters a widening into the ledger as `baseline` — explicitly unchecked —
 * and nothing else. An entry the ledger already has is left alone whatever
 * its status (a widening never re-baselines and never converts a `confirmed`
 * entry back); a citation the branch's tree no longer makes is skipped, not
 * recorded stale. The site count is the SMALLER of the merge-base tree's and
 * the branch tree's: a site the branch added is a new, unchecked site that
 * reds as `new-sites` until confirmed, exactly as a copy of any recorded
 * line does.
 */
export function widenLedger(
    ledger: Ledger,
    widening: Widening,
    afterCitations: Iterable<Citation>
): {
    ledger: Ledger;
    added: LedgerEntry[];
    alreadyRecorded: number;
    gone: number;
} {
    const after = treeCitations(afterCitations);
    const recorded = new Set(ledger.entries.map((e) => entryKey(e.id, e.line)));
    const added: LedgerEntry[] = [];
    let alreadyRecorded = 0;
    let gone = 0;
    for (const [key, cit] of widening) {
        if (recorded.has(key)) {
            alreadyRecorded++;
            continue;
        }
        const now = after.get(key);
        if (!now) {
            gone++;
            continue;
        }
        added.push({
            id: cit.id,
            line: cit.line,
            sites: Math.min(cit.sites.length, now.sites.length),
            status: "baseline",
        });
    }
    return {
        ledger: { ...ledger, entries: [...ledger.entries, ...added] },
        added,
        alreadyRecorded,
        gone,
    };
}

export type WideningPlan =
    | { kind: "refused"; why: string }
    | {
          kind: "ok";
          ledger: Ledger;
          added: LedgerEntry[];
          alreadyRecorded: number;
          gone: number;
          /** Uncovered citations whose id resolves to nothing: NOT entered —
           *  the existence scan reds on them, so they are fixed on their
           *  lines and confirmed under the right id. */
          unresolvable: TreeCitation[];
      };

/**
 * The `widen` command's decision, pure so its refusals have fixtures. It
 * refuses when the diff carries no tokenizer change (a widening with no cause
 * in the same diff is a regeneration under another name), when the change is
 * not a superset of what it replaces (`lost` — a re-keying, see `wideningOf`),
 * and when the changed tokenizer uncovers nothing on the merge-base tree
 * (nothing to license). `wideningOf` has already excluded everything the
 * pre-widening tokenizer saw — that refusal is structural, not a branch here.
 */
export function planWidening(input: {
    tokenizerChanged: boolean;
    widening: Widening;
    lost: LedgerEntry[];
    ledger: Ledger;
    afterCitations: Iterable<Citation>;
    ids: Set<string>;
}): WideningPlan {
    if (!input.tokenizerChanged)
        return {
            kind: "refused",
            why: "the tokenizer is unchanged against the merge-base — a widening records what a tokenizer CHANGE uncovered, and this diff carries none. Confirm open citations one line at a time instead.",
        };
    if (input.lost.length)
        return {
            kind: "refused",
            why:
                `the changed tokenizer no longer makes ${input.lost.length} citation(s) the merge-base ledger records, on the merge-base tree — this change narrows or re-keys what a citation is, it does not widen it, and a widening is the only growth the ledger licenses. First of them:\n` +
                input.lost
                    .slice(0, 5)
                    .map((e) => `  CR ${e.id}  ${e.line.slice(0, 120)}`)
                    .join("\n"),
        };
    if (!input.widening.size)
        return {
            kind: "refused",
            why: "the changed tokenizer sees nothing on the merge-base tree that its ledger lacks — nothing was widened. Confirm open citations one line at a time instead.",
        };
    const unresolvable: TreeCitation[] = [];
    const resolvable: Widening = new Map();
    for (const [key, cit] of input.widening) {
        if (input.ids.has(cit.id)) resolvable.set(key, cit);
        else unresolvable.push(cit);
    }
    return {
        kind: "ok",
        ...widenLedger(input.ledger, resolvable, input.afterCitations),
        unresolvable,
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
            `\n${report.grown.length} \`baseline\` entr${report.grown.length === 1 ? "y" : "ies"} the base branch's ledger does not have, or records more sites than the base's entry — the baseline only shrinks (nothing enters unchecked; a tokenizer widening licenses only what it uncovered on the merge-base tree, at the sites it had there):\n`
        );
        out.push(
            cap(report.grown)
                .map((e) => `  CR ${e.id}  ${clip(e.line, 160)}`)
                .join("\n")
        );
        out.push(more(report.grown.length));
        out.push(
            `  Delete the entry and confirm the line instead (\`bun run cr:ledger confirm <file>:<line>\`).\n` +
                `  If this diff changes what counts as a citation, \`bun run cr:ledger widen\` records exactly what the change uncovered.`
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
