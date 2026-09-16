#!/usr/bin/env bun
/**
 * CR-citation sweep (ADR 0098).
 *
 * Every `CR NNN[.Nx]` citation in a tracked file must resolve to a rule that
 * actually exists in the vendored Comprehensive Rules
 * (`data/cr/comprehensive-rules.txt`). A citation nobody can look up is worse
 * than no citation: it reads as provenance, survives review, and sends the next
 * reader to a rule that says something else — or to nothing at all.
 *
 * The failure mode this catches is model memory, not a stale source. 44
 * unresolvable ids stood in the repo when this guard was written; of the first
 * 42 traced, 40 existed in NO revision of the CR (2022, 2025, 2026 all checked)
 * — they were recalled, never printed.
 *
 * Usage:
 *   bun run cr:lint            # report unresolvable citations, exit 1 if any
 *   bun run cr:lint --files    # also list every file/line for each bad id
 *
 * Wired into `check:guards` (issue #2429) once the 44 standing violations were
 * corrected. `scripts/__tests__/cr-citations.test.ts` is the regression guard —
 * it runs the same scan under `bun run test` so a bad citation cannot land even
 * if the gate wiring is later changed.
 *
 * SCOPE: the scan is line-based, and a line is scanned in two passes. The first
 * resolves every id carrying its own `CR ` prefix. The second — on any line that
 * already mentions `CR ` — resolves every BARE `NNN.N[a-z]` token on it too, so
 * a citation written inside a slash-list ("CR 205.4a / 602.5b / 603.3b", where
 * only the first id is prefixed) is covered. That second pass is not a nicety:
 * two of the 44 bad ids #2429 corrected — 10 sites — lived in exactly that
 * shape (`706.5c` in `gre/sba.ts`'s SBA roll-call, `112.5` repeated across nine
 * copy-a-spell sites). Both survived the first correction pass and were found
 * only by a hand-rolled id-agnostic re-sweep; that is now the guard's job, not
 * the auditor's.
 *
 * REMAINING BLIND SPOT: a citation WRAPPED ACROSS TWO LINES — the `CR ` prefix
 * on one comment line and the id on the next — is still invisible, because both
 * passes are anchored to a single line. One such site existed
 * (`src/lib/ai/__tests__/flashback-exile-color.bot.test.ts`) and was rewritten
 * onto one line in #2429. Extending the bare pass to a window of adjacent lines
 * is not free — it would resolve ordinary prose numbers on the line AFTER any CR
 * mention, where the single-line rule stays exact (24,656 tokens scanned over
 * the #2429 tree, zero false positives). Keep citations on one line.
 *
 * WIDENING THE SCAN is a recorded operation (issue #3697): every citation a
 * wider tokenizer newly sees needs a ledger entry (ADR 0133), and
 * `bun run cr:ledger widen` enters as `baseline` exactly the ones the change
 * uncovered on the merge-base tree — the gate re-derives that set from this
 * file's diff against the merge-base (`repoWidening`), so a widening can
 * never double as a regeneration.
 */
import { readFileSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    formatHit,
    keywordIndex,
    scanKeywordCitations,
} from "./cr-keyword-citations.ts";
import {
    formatLifePaymentHit,
    scanLifePaymentMiscitations,
} from "./cr-118-4-life-payment.ts";
import {
    formatSubruleHit,
    scanSubruleMiscitations,
} from "./cr-616-1-subrule-citations.ts";
import { enterGuardCache, type GuardInputs } from "./lib/guard-cache.ts";
import { baseArtifact, gitRunner } from "./lib/base-artifact.ts";
import { ORIGIN_BASE } from "./lib/branches.ts";
import {
    baselineSites,
    formatReport,
    LEDGER_PATH,
    ledgerReport,
    parseLedger,
    reportIsClean,
    wideningOf,
    type Citation,
    type Ledger,
    type LedgerEntry,
    type LedgerReport,
    type Widening,
} from "./lib/cr-ledger.ts";
import { loadRules } from "./lib/cr-rules.ts";

// `import.meta.dir` is Bun-only; the regression guard imports this module under
// vitest/node, where it is undefined.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CR_PATH = join(ROOT, "data/cr/comprehensive-rules.txt");

/** Text surfaces where a CR citation is meaningful. */
export const SCANNED = /\.(ts|tsx|mts|mjs|js|md)$/;

/**
 * The file that defines what counts as a citation — `scanCitations` and the
 * two regexes below, plus `SCANNED`. A diff that leaves it byte-identical to
 * the merge-base's carries no tokenizer change, so a `baseline` entry it adds
 * cannot be a widening's (issue #3697).
 */
export const TOKENIZER_PATH = "scripts/check-cr-citations.ts";

export function knownRuleIds(): Set<string> {
    // U+2028 is a paragraph break INSIDE a rule in WotC's export; JS does not
    // treat it as a line terminator, so a rule containing one is invisible to a
    // line-start match and reads as "does not exist" (509.1b, 205.4c).
    const lines = readFileSync(CR_PATH, "utf8")
        .replace(/\r/g, "")
        .replace(/[\u2028\u2029]/g, "\n")
        .split("\n");
    const body = lines.slice(
        lines.lastIndexOf("1. Game Concepts"),
        lines.lastIndexOf("Glossary")
    );
    const ids = new Set<string>();
    for (const line of body) {
        const m = line.match(/^(\d{3}(?:\.\d+[a-z]{0,2})?)\.?\s+/);
        if (m) ids.add(m[1]);
    }
    return ids;
}

export type Hit = { file: string; line: number };

export interface ScanResult {
    /** bad rule id → every `file:line` that cites it. */
    bad: Map<string, Hit[]>;
    /** Total citations seen (resolvable or not). */
    total: number;
    /**
     * Every citation seen, resolvable or not, with the raw line — the single
     * tokenizer the citation ledger (`lib/cr-ledger.ts`, ADR 0133) is
     * accountable for, so the two scans cannot disagree on what a citation is.
     */
    citations: Citation[];
}

/** Every tracked file a CR citation could live in. */
export function scannedFiles(root = ROOT): string[] {
    return execSync("git ls-files", {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 << 20,
    })
        .split("\n")
        .filter((f) => SCANNED.test(f));
}

/** An id carrying its own `CR ` prefix. The subrule part is optional. */
const PREFIXED_CITATION = /\bCR\s?(\d{3})(\.\d+[a-z]{0,2})?/g;

/**
 * A bare `NNN.N[a-z]` id, resolved only on lines that already mention `CR `.
 * The three-digits-then-dot anchor plus the word boundaries are what keep
 * version strings and dates out (`1.2.3`, `2026.08.07` cannot match): the
 * subrule part is mandatory here, unlike the prefixed form, because a bare
 * three-digit number is just a number.
 */
const BARE_ID = /\b\d{3}\.\d+[a-z]{0,2}\b/g;

/**
 * The scan itself, over `(file, text)` pairs — pure, so the regression test can
 * drive it with synthetic content instead of the working tree.
 */
export function scanCitations(
    sources: Iterable<{ file: string; text: string }>,
    ids: Set<string>
): ScanResult {
    const bad = new Map<string, Hit[]>();
    const citations: Citation[] = [];
    let total = 0;
    for (const { file, text } of sources) {
        if (!text.includes("CR ")) continue;
        text.split("\n").forEach((line, i) => {
            const record = (id: string) => {
                total++;
                citations.push({ file, line: i + 1, id, text: line });
                if (ids.has(id)) return;
                const hits = bad.get(id) ?? [];
                hits.push({ file, line: i + 1 });
                bad.set(id, hits);
            };
            // Pass 1: prefixed ids. Remember where each id's digits START so
            // pass 2 does not count the same token twice.
            const counted = new Set<number>();
            for (const m of line.matchAll(PREFIXED_CITATION)) {
                const id = m[1] + (m[2] ?? "");
                counted.add(m.index + m[0].length - id.length);
                record(id);
            }
            // Pass 2: bare ids sharing a line with a CR mention — the
            // slash-list shape ("CR 707.10b / 114.5 / 603.3d").
            if (!line.includes("CR ")) return;
            for (const m of line.matchAll(BARE_ID)) {
                if (counted.has(m.index)) continue;
                record(m[0]);
            }
        });
    }
    return { bad, total, citations };
}

/** Every tracked source, read once — shared by both scans. */
export function readSources(root = ROOT): { file: string; text: string }[] {
    const sources: { file: string; text: string }[] = [];
    for (const file of scannedFiles(root)) {
        try {
            sources.push({
                file,
                text: readFileSync(join(root, file), "utf8"),
            });
        } catch {
            continue;
        }
    }
    return sources;
}

/**
 * Every `SCANNED` source as a COMMIT has it, read out of the object store in
 * one `cat-file --batch` — the merge-base tree a tokenizer widening is
 * measured on (issue #3697). Byte-exact: sizes come from the batch headers,
 * so a multi-byte file is sliced where git says it ends, not where a string
 * length would.
 */
export function sourcesAt(
    root: string,
    ref: string
): { file: string; text: string }[] {
    const files = execFileSync(
        "git",
        ["ls-tree", "-r", "--name-only", "-z", ref],
        { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }
    )
        .split("\0")
        .filter((f) => SCANNED.test(f));
    // The request list is newline-delimited, and git permits a newline in a
    // path: one would split into two requests and desync every header after
    // it — silently, since the sizes still parse. None exists; refuse rather
    // than attribute the wrong text to the wrong file.
    const broken = files.find((f) => f.includes("\n"));
    if (broken !== undefined)
        throw new Error(
            `git cat-file --batch: a tracked path contains a newline (${JSON.stringify(broken)}) — the batch request cannot carry it`
        );
    const batch = execFileSync("git", ["cat-file", "--batch"], {
        cwd: root,
        input: files.map((f) => `${ref}:${f}\n`).join(""),
        maxBuffer: 512 << 20,
    });
    const sources: { file: string; text: string }[] = [];
    let pos = 0;
    for (const file of files) {
        const nl = batch.indexOf(0x0a, pos);
        if (nl === -1)
            throw new Error(
                `git cat-file --batch ended early at ${ref}:${file}`
            );
        const header = batch.toString("utf8", pos, nl);
        pos = nl + 1;
        // `<object> missing` — a path ls-tree listed that the batch could not
        // read; nothing follows the header.
        if (header.endsWith(" missing")) continue;
        const size = Number(header.split(" ")[2]);
        if (!Number.isInteger(size))
            throw new Error(
                `git cat-file --batch: unreadable header for ${ref}:${file}: ${header}`
            );
        sources.push({ file, text: batch.toString("utf8", pos, pos + size) });
        pos += size + 1;
    }
    return sources;
}

/** Reads every tracked source and scans it. Used by the CLI and the guard. */
export function scanRepo(root = ROOT): ScanResult & { fileCount: number } {
    const sources = readSources(root);
    return {
        ...scanCitations(sources, knownRuleIds()),
        fileCount: sources.length,
    };
}

/**
 * The keyword-semantics scan (`cr-keyword-citations.ts`), reported alongside
 * the existence scan because they answer the two halves of one question: does
 * the id resolve, and does it mean what the line says. Both run under
 * `bun run cr:lint`, so `check:guards` covers both with no new wiring.
 */
function keywordScan(showFiles: boolean): number {
    const index = keywordIndex();
    const { hits, scanned } = scanKeywordCitations(readSources(), index);
    console.log(
        `\nscanned ${scanned} CR 701/702 keyword citations against their section titles`
    );
    if (!hits.length) {
        console.log("every keyword citation names the section it cites");
        return 0;
    }
    console.log(
        `\n${hits.length} citation(s) point at a DIFFERENT keyword than the line names:\n`
    );
    for (const hit of showFiles ? hits : hits.slice(0, 25)) {
        console.log(formatHit(hit, index));
    }
    if (!showFiles && hits.length > 25) {
        console.log(`  … ${hits.length - 25} more (re-run with --files)`);
    }
    console.log(
        `\nPrint both rules with \`bun run cr <id>\` before editing. If the citation is` +
            `\nright and the line simply never names its keyword, say the keyword on that line.`
    );
    return 1;
}

/**
 * The CR 118.4 life-payment scan (`cr-118-4-life-payment.ts`, issue #2559) —
 * a third "resolvable but wrong" check alongside the keyword scan, for the
 * narrow shape where `CR 118.4` ("some costs include an X") is cited for a
 * claim about paying life, which is CR 119.4's rule instead.
 */
function lifePaymentScan(showFiles: boolean): number {
    return reportTargetedScan(
        scanLifePaymentMiscitations(readSources()),
        formatLifePaymentHit,
        showFiles,
        {
            clean: "no CR 118.4 citation is attached to a claim about paying life",
            dirty: "citation(s) of CR 118.4 describe paying life (that's CR 119.4)",
            advice:
                `Print \`bun run cr 119.4\` before editing. If the cost also names an` +
                `\n{X} placeholder (CR 107.3), cite both: "CR 118.4 / 119.4".`,
        }
    );
}

/**
 * The CR 616.1c/616.1d scan (`cr-616-1-subrule-citations.ts`, issue #3014) —
 * the priority-tier letters of the replacement-ordering procedure cited for
 * the once-per-event rule (CR 614.5) or the choose-the-order rule (CR 616.1e).
 */
function subruleScan(showFiles: boolean): number {
    return reportTargetedScan(
        scanSubruleMiscitations(readSources()),
        formatSubruleHit,
        showFiles,
        {
            clean: "no CR 616.1c/616.1d citation is attached to a claim that subrule does not make",
            dirty: "citation(s) of CR 616.1c/616.1d state a claim the subrule does not make",
            advice:
                `Print \`bun run cr 614.5\` and \`bun run cr 616.1\` before editing. A line that is` +
                `\nreally about a copy (616.1c) or a back-face-up entry (616.1d) should say so.`,
        }
    );
}

/** The base branch's ledger and the commit it was read at. */
export type BaseLedger = { ledger: Ledger; mergeBase: string };

/**
 * The base branch's ledger, for the only-shrinks check and the widening — or
 * `null` when it cannot be read. `broken` is thrown, never skipped: a guard
 * that cannot read its baseline is a guard that is not there
 * (`lib/base-artifact.ts`).
 */
export function baseLedger(root = ROOT): BaseLedger | null {
    const base = baseArtifact(gitRunner(root), LEDGER_PATH);
    if (base.kind === "broken") {
        throw new Error(
            `the base-branch ledger could not be read — ${base.detail}\n` +
                `    This is NOT a skip: a guard that cannot read its baseline is a guard that is not there.`
        );
    }
    if (base.kind === "unavailable") return null;
    try {
        return {
            ledger: parseLedger(base.text),
            mergeBase: base.at.slice(0, base.at.indexOf(":")),
        };
    } catch (err) {
        throw new Error(
            `the base-branch ledger at ${base.at} does not parse: ${(err as Error).message}`
        );
    }
}

/** The base branch's `baseline` set with site counts, or `null` without a base ledger. */
export function baseBaselineSites(root = ROOT): Map<string, number> | null {
    const base = baseLedger(root);
    return base === null ? null : baselineSites(base.ledger);
}

export type RepoWidening = {
    /** Whether `TOKENIZER_PATH` differs from the merge-base's copy. */
    tokenizerChanged: boolean;
    /** Empty when the tokenizer is unchanged — the merge-base tree is not read. */
    widening: Widening;
    /** Merge-base entries the current tokenizer no longer makes there: a
     *  re-keying, not a widening, so nothing is licensed (`wideningOf`). */
    lost: LedgerEntry[];
};

/**
 * The tokenizer widening this checkout carries against the base branch
 * (issue #3697): none unless `TOKENIZER_PATH` differs from its merge-base
 * copy; otherwise the current tokenizer's walk of the MERGE-BASE tree minus
 * what the merge-base ledger records (`wideningOf`). Offline — the tree comes
 * out of the object store.
 */
export function repoWidening(base: BaseLedger, root = ROOT): RepoWidening {
    const at = `${base.mergeBase}:${TOKENIZER_PATH}`;
    const shown = gitRunner(root)(["show", at]);
    if (!shown.ok)
        throw new Error(
            `the merge-base tokenizer could not be read — git show ${at} failed: ${shown.error}`
        );
    const current = readFileSync(join(root, TOKENIZER_PATH), "utf8");
    if (shown.out === current)
        return { tokenizerChanged: false, widening: new Map(), lost: [] };
    const before = scanCitations(
        sourcesAt(root, base.mergeBase),
        knownRuleIds()
    ).citations;
    const { uncovered, lost } = wideningOf(before, base.ledger);
    return { tokenizerChanged: true, widening: uncovered, lost };
}

/** The widening the gate licenses: the diff's, only if it is a real one. */
export function licensedWidening(w: RepoWidening): Widening | null {
    return w.tokenizerChanged && !w.lost.length ? w.widening : null;
}

/**
 * The citation ledger check (`lib/cr-ledger.ts`, ADR 0133) over the tracked
 * tree: every citation the existence scan saw, against the committed ledger,
 * the vendored rules, the base branch's baseline set and — only when a
 * `baseline` entry the base lacks makes it matter, because it reads the whole
 * merge-base tree — the tokenizer widening the diff carries. Shared by the
 * CLI and the regression test so both red on the same report.
 */
export function ledgerReportForRepo(
    citations: Citation[],
    root = ROOT
): LedgerReport {
    const base = baseLedger(root);
    const input = {
        citations,
        ledger: parseLedger(readFileSync(join(root, LEDGER_PATH), "utf8")),
        rules: loadRules(join(root, "data/cr/comprehensive-rules.txt")),
        baseBaseline: base === null ? null : baselineSites(base.ledger),
    };
    const report = ledgerReport({ ...input, widened: null });
    if (!report.grown.length || base === null) return report;
    const widened = licensedWidening(repoWidening(base, root));
    return widened === null ? report : ledgerReport({ ...input, widened });
}

function ledgerScan(citations: Citation[], showFiles: boolean): number {
    let report: LedgerReport;
    try {
        report = ledgerReportForRepo(citations);
    } catch (err) {
        // A ledger that cannot be read — ours or the base branch's — is the
        // guard's own failure, reported as a red line rather than a stack.
        console.log(`\n✗ CR citation ledger: ${(err as Error).message}`);
        return 1;
    }
    const tier = report.baselineChecked
        ? "baseline compared with the base branch" +
          (report.widened
              ? `; ${report.widened} baseline entr${report.widened === 1 ? "y" : "ies"} licensed by this diff's tokenizer widening`
              : "")
        : "no base-branch ledger to compare the baseline with";
    console.log(
        `\n${report.recorded} CR citations recorded in ${LEDGER_PATH} (${tier})`
    );
    if (reportIsClean(report)) {
        console.log(
            "every citation has a ledger entry that still matches its rule"
        );
        return 0;
    }
    console.log(formatReport(report, showFiles));
    return 1;
}

/** The report shape every targeted "resolvable but wrong" scan shares. */
function reportTargetedScan<H>(
    hits: H[],
    format: (hit: H) => string,
    showFiles: boolean,
    text: { clean: string; dirty: string; advice: string }
): number {
    if (!hits.length) {
        console.log(`\n${text.clean}`);
        return 0;
    }
    console.log(`\n${hits.length} ${text.dirty}:\n`);
    for (const hit of showFiles ? hits : hits.slice(0, 25)) {
        console.log(format(hit));
    }
    if (!showFiles && hits.length > 25) {
        console.log(`  … ${hits.length - 25} more (re-run with --files)`);
    }
    console.log(`\n${text.advice}`);
    return 1;
}

function main(): number {
    const showFiles = process.argv.includes("--files");
    const ruleCount = knownRuleIds().size;
    const { bad, total, fileCount, citations } = scanRepo();

    console.log(
        `scanned ${fileCount} files, ${total} CR citations, ${ruleCount} rules in the vendored CR`
    );
    if (!bad.size) {
        console.log("all citations resolve");
        const keywordResult = keywordScan(showFiles);
        const lifePaymentResult = lifePaymentScan(showFiles);
        const subruleResult = subruleScan(showFiles);
        const ledgerResult = ledgerScan(citations, showFiles);
        return (
            keywordResult || lifePaymentResult || subruleResult || ledgerResult
        );
    }
    console.log(`\n${bad.size} unresolvable rule ids:\n`);
    for (const [id, hits] of [...bad.entries()].sort(
        (a, b) => b[1].length - a[1].length
    )) {
        console.log(
            `  ${id.padEnd(10)} ${String(hits.length).padStart(4)} citations`
        );
        if (showFiles)
            for (const h of hits) console.log(`      ${h.file}:${h.line}`);
    }
    console.log(
        `\nFind the real rule with \`bun run cr grep "<keyword>"\` — never guess the letter.`
    );
    keywordScan(showFiles);
    lifePaymentScan(showFiles);
    subruleScan(showFiles);
    ledgerScan(citations, showFiles);
    return 1;
}

/**
 * What the scan reads (issue #3646): every tracked `SCANNED` file, the vendored
 * CR and the citation ledger beside it, and — covered by the same `.ts` glob —
 * this script and the scans it imports. Untracked files are declared too; they
 * are not scanned, so they only ever cost a cache miss. The ledger's
 * only-shrinks tier also reads the merge-base commit, which no file in the
 * tree records — hence the key.
 */
export function crLintInputs(): GuardInputs {
    const mergeBase = gitRunner(ROOT)(["merge-base", "HEAD", ORIGIN_BASE]);
    return {
        guard: "cr:lint",
        globs: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.mts",
            "**/*.mjs",
            "**/*.js",
            "**/*.md",
            "data/cr/**",
        ],
        keys: [
            mergeBase.ok
                ? `merge-base:${mergeBase.out.trim()}`
                : `no-merge-base:${mergeBase.error}`,
        ],
    };
}

// CLI only. The regression guard (`scripts/__tests__/cr-citations.test.ts`)
// imports the exported scan functions; without this gate the import would tear
// the test runner down with `process.exit`.
if (import.meta.main) {
    enterGuardCache(crLintInputs(), ROOT);
    process.exit(main());
}
