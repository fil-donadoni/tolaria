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
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
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

// `import.meta.dir` is Bun-only; the regression guard imports this module under
// vitest/node, where it is undefined.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CR_PATH = join(ROOT, "data/cr/comprehensive-rules.txt");

/** Text surfaces where a CR citation is meaningful. */
export const SCANNED = /\.(ts|tsx|mts|mjs|js|md)$/;

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
    let total = 0;
    for (const { file, text } of sources) {
        if (!text.includes("CR ")) continue;
        text.split("\n").forEach((line, i) => {
            const record = (id: string) => {
                total++;
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
    return { bad, total };
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
    const hits = scanLifePaymentMiscitations(readSources());
    if (!hits.length) {
        console.log(
            "\nno CR 118.4 citation is attached to a claim about paying life"
        );
        return 0;
    }
    console.log(
        `\n${hits.length} citation(s) of CR 118.4 describe paying life (that's CR 119.4):\n`
    );
    for (const hit of showFiles ? hits : hits.slice(0, 25)) {
        console.log(formatLifePaymentHit(hit));
    }
    if (!showFiles && hits.length > 25) {
        console.log(`  … ${hits.length - 25} more (re-run with --files)`);
    }
    console.log(
        `\nPrint \`bun run cr 119.4\` before editing. If the cost also names an` +
            `\n{X} placeholder (CR 107.3), cite both: "CR 118.4 / 119.4".`
    );
    return 1;
}

function main(): number {
    const showFiles = process.argv.includes("--files");
    const ruleCount = knownRuleIds().size;
    const { bad, total, fileCount } = scanRepo();

    console.log(
        `scanned ${fileCount} files, ${total} CR citations, ${ruleCount} rules in the vendored CR`
    );
    if (!bad.size) {
        console.log("all citations resolve");
        const keywordResult = keywordScan(showFiles);
        const lifePaymentResult = lifePaymentScan(showFiles);
        return keywordResult || lifePaymentResult;
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
    return 1;
}

// CLI only. The regression guard (`scripts/__tests__/cr-citations.test.ts`)
// imports the exported scan functions; without this gate the import would tear
// the test runner down with `process.exit`.
if (import.meta.main) process.exit(main());
