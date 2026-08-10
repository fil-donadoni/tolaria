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
 * NOT wired into `check:all` yet — the standing violations are tracked for
 * cleanup first (see the ADR). Run it before adding a citation.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CR_PATH = join(ROOT, "data/cr/comprehensive-rules.txt");

/** Text surfaces where a CR citation is meaningful. */
const SCANNED = /\.(ts|tsx|mts|mjs|js|md)$/;

function knownRuleIds(): Set<string> {
    const lines = readFileSync(CR_PATH, "utf8").replace(/\r/g, "").split("\n");
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

type Hit = { file: string; line: number };

function main(): number {
    const showFiles = process.argv.includes("--files");
    const ids = knownRuleIds();
    const files = execSync("git ls-files", {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 64 << 20,
    })
        .split("\n")
        .filter((f) => SCANNED.test(f));

    const bad = new Map<string, Hit[]>();
    let total = 0;
    for (const file of files) {
        let text: string;
        try {
            text = readFileSync(join(ROOT, file), "utf8");
        } catch {
            continue;
        }
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

    console.log(
        `scanned ${files.length} files, ${total} CR citations, ${ids.size} rules in the vendored CR`
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

process.exit(main());
