/**
 * The prose sweep behind `bun run cr:lint --all-prose` (issue #8724).
 *
 * `cr:lint` is diff-honest: a citation is read when its line is touched. ADR
 * prose written against an older Comprehensive Rules text is never touched
 * again, so it keeps citing ids the CR has since renumbered (the untap step
 * once cited as a rule that is now phasing; player control as one that is now
 * Omen). This
 * module reads EVERY `CR <id>` in `docs/**` once, regardless of the diff, and
 * reports four things. It is a report, never a gate (the gate stays offline
 * and diff-scoped, ADR 0098/0133):
 *
 *   a. unresolved   — ids that resolve to no rule;
 *   b. keyword      — `701.N`/`702.N` ids whose section title is not the
 *                     keyword the sentence names (`cr-keyword-citations.ts`);
 *   c. drifted      — `confirmed` ledger entries whose printed rule text no
 *                     longer hashes to what the reader confirmed;
 *   d. suspect      — ids whose printed rule shares no content word with the
 *                     citing line. The only signal that sees a renumbering
 *                     which lands on a real rule and a line naming no
 *                     keyword — a heuristic, so a list for a reader to open
 *                     with `bun run cr <id>`, not a verdict.
 *
 * Pure over its inputs (sources, rules, ledger), so the regression test
 * drives it with fixtures.
 */
import {
    scanKeywordCitations,
    type KeywordHit,
    type KeywordIndex,
} from "../cr-keyword-citations.ts";
import {
    entryKey,
    normalizeLine,
    treeCitations,
    type Citation,
    type Ledger,
} from "./cr-ledger.ts";
import { printedRule, ruleHash, type Rule } from "./cr-rules.ts";

/** Files the sweep reads: every markdown document under `docs/`. */
export const PROSE_PATH = /^docs\/.*\.md$/;

export type ProseSource = { file: string; text: string };

export type SuspectCitation = {
    file: string;
    line: number;
    id: string;
    text: string;
};

export type ProseSweep = {
    files: number;
    citations: number;
    /** Unresolvable id → `file:line` sites. */
    unresolved: Map<string, { file: string; line: number }[]>;
    keyword: KeywordHit[];
    keywordScanned: number;
    drifted: SuspectCitation[];
    /** Citations whose ledger entry is `baseline`: recorded, never read. */
    unread: number;
    suspects: SuspectCitation[];
};

/** Words too common in rules prose to show a citation says what the rule says. */
const STOP = new Set([
    "about",
    "after",
    "again",
    "being",
    "cards",
    "could",
    "every",
    "other",
    "player",
    "rules",
    "should",
    "their",
    "there",
    "these",
    "those",
    "under",
    "which",
    "while",
    "would",
]);

/** Content words of a text as 5-letter stems (`untaps`/`untapped` → `untap`). */
export function contentStems(text: string): Set<string> {
    const stems = new Set<string>();
    for (const word of text.toLowerCase().match(/[a-z]{5,}/g) ?? []) {
        if (STOP.has(word)) continue;
        stems.add(word.slice(0, 5));
    }
    return stems;
}

/**
 * The line's prose with every rule id and the `CR` prefix removed, so the ids
 * under test never vouch for themselves.
 */
function claimOf(line: string): string {
    return line
        .replace(/\bCR\s?\d{3}(\.\d+[a-z]{0,2})?/g, " ")
        .replace(/\b\d{3}\.\d+[a-z]{0,2}\b/g, " ");
}

/** True when the printed rule shares no content word with the citing line. */
export function sharesNoWord(line: string, printed: string): boolean {
    const claim = contentStems(claimOf(line));
    if (!claim.size) return false;
    const rule = contentStems(printed);
    for (const stem of claim) if (rule.has(stem)) return false;
    return true;
}

export function proseSweep(input: {
    sources: Iterable<ProseSource>;
    citations: Citation[];
    unresolved: Map<string, { file: string; line: number }[]>;
    rules: Rule[];
    ledger: Ledger;
    index: KeywordIndex;
}): ProseSweep {
    const sources = [...input.sources].filter((s) => PROSE_PATH.test(s.file));
    const inScope = new Set(sources.map((s) => s.file));
    const citations = input.citations.filter((c) => inScope.has(c.file));
    const unresolved = new Map<string, { file: string; line: number }[]>();
    for (const [id, hits] of input.unresolved) {
        const kept = hits.filter((h) => inScope.has(h.file));
        if (kept.length) unresolved.set(id, kept);
    }
    const { hits: keyword, scanned } = scanKeywordCitations(
        sources,
        input.index
    );
    const byKey = new Map(
        input.ledger.entries.map((e) => [entryKey(e.id, e.line), e] as const)
    );
    const drifted: SuspectCitation[] = [];
    const suspects: SuspectCitation[] = [];
    let unread = 0;
    const printedCache = new Map<string, string | null>();
    const printed = (id: string) => {
        if (!printedCache.has(id))
            printedCache.set(id, printedRule(input.rules, id));
        return printedCache.get(id) ?? null;
    };
    for (const cit of citations) {
        const text = printed(cit.id);
        if (text === null) continue;
        const site = { file: cit.file, line: cit.line, id: cit.id };
        const entry = byKey.get(entryKey(cit.id, normalizeLine(cit.text)));
        if (entry?.status === "baseline") unread++;
        if (entry?.status === "confirmed" && ruleHash(text) !== entry.ruleHash)
            drifted.push({ ...site, text: cit.text.trim() });
        // A reader confirmed this line against the printed rule: not suspect.
        if (entry?.status === "confirmed") continue;
        if (sharesNoWord(cit.text, text))
            suspects.push({ ...site, text: cit.text.trim() });
    }
    return {
        files: sources.length,
        citations: treeCitations(citations).size,
        unresolved,
        keyword,
        keywordScanned: scanned,
        drifted,
        unread,
        suspects,
    };
}

/** The sweep's one-screen report; `showAll` lifts the per-section cap. */
export function formatProseSweep(sweep: ProseSweep, showAll: boolean): string {
    const cap = showAll ? Infinity : 40;
    const out: string[] = [
        `prose sweep: ${sweep.files} docs files, ${sweep.citations} distinct CR citations (report only, never a gate)`,
        `  a. unresolved ids:            ${sweep.unresolved.size}`,
        `  b. keyword/title mismatches:  ${sweep.keyword.length} (of ${sweep.keywordScanned} keyword citations)`,
        `  c. confirmed, rule text moved: ${sweep.drifted.length}`,
        `  d. suspect (no shared word):  ${sweep.suspects.length}`,
        `  baseline entries never read:  ${sweep.unread}`,
    ];
    const section = (title: string, rows: string[]) => {
        if (!rows.length) return;
        out.push("", title);
        out.push(...rows.slice(0, cap));
        if (rows.length > cap)
            out.push(`  … ${rows.length - cap} more (re-run with --files)`);
    };
    section(
        "a. unresolved:",
        [...sweep.unresolved].flatMap(([id, hits]) =>
            hits.map((h) => `  ${h.file}:${h.line}  ${id}`)
        )
    );
    section(
        "b. keyword mismatch:",
        sweep.keyword.map(
            (h) =>
                `  ${h.file}:${h.line}  ${h.offending.join(", ")} (line names ${h.named.join(", ")})`
        )
    );
    section(
        "c. confirmed, rule text moved:",
        sweep.drifted.map((s) => `  ${s.file}:${s.line}  ${s.id}`)
    );
    section(
        "d. suspect — open with `bun run cr <id>`:",
        sweep.suspects.map(
            (s) => `  ${s.file}:${s.line}  ${s.id}  ${s.text.slice(0, 90)}`
        )
    );
    return out.join("\n");
}
