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
 * The failure mode this catches is model memory, not a stale source. Of the 42
 * unresolvable ids found when this guard was written, 40 existed in NO revision
 * of the CR (2022, 2025, 2026 all checked) — they were recalled, never printed.
 *
 * Usage:
 *   bun run cr:lint            # report unresolvable citations, exit 1 if any
 *   bun run cr:lint --files    # also list every file/line for each bad id
 *
 * Wired into `check:guards` (issue #2429) once the 42 standing violations were
 * corrected. `scripts/__tests__/cr-citations.test.ts` is the regression guard —
 * it runs the same scan under `bun run test` so a bad citation cannot land even
 * if the gate wiring is later changed.
 *
 * KNOWN BLIND SPOT: the scan is line-based and requires the `CR ` prefix, so a
 * citation written bare inside a slash-list ("CR 205.4a / 602.5b" — the second
 * id has no prefix) or wrapped across two comment lines is invisible to it.
 * Both shapes existed in the repo and were corrected by hand in #2429; two
 * unresolvable ids hiding in that blind spot (one in `gre/sba.ts`'s SBA
 * roll-call, one repeated across nine copy-a-spell sites) survived the first
 * pass and were found only by an id-agnostic re-sweep that extracts EVERY
 * `NNN.N[a-z]` token near a CR mention and resolves each. Re-run that sweep by
 * hand when auditing; this guard will not do it for you.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
            for (const m of line.matchAll(
                /\bCR\s?(\d{3})(\.\d+[a-z]{0,2})?/g
            )) {
                total++;
                const id = m[1] + (m[2] ?? "");
                if (ids.has(id)) continue;
                const hits = bad.get(id) ?? [];
                hits.push({ file, line: i + 1 });
                bad.set(id, hits);
            }
        });
    }
    return { bad, total };
}

/** Reads every tracked source and scans it. Used by the CLI and the guard. */
export function scanRepo(root = ROOT): ScanResult & { fileCount: number } {
    const files = scannedFiles(root);
    const sources: { file: string; text: string }[] = [];
    for (const file of files) {
        try {
            sources.push({
                file,
                text: readFileSync(join(root, file), "utf8"),
            });
        } catch {
            continue;
        }
    }
    return {
        ...scanCitations(sources, knownRuleIds()),
        fileCount: files.length,
    };
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
        return 0;
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
    return 1;
}

// CLI only. The regression guard (`scripts/__tests__/cr-citations.test.ts`)
// imports the exported scan functions; without this gate the import would tear
// the test runner down with `process.exit`.
if (import.meta.main) process.exit(main());
