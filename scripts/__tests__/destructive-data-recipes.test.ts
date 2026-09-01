// Two data-regeneration recipes that read as routine and silently destroy
// committed data. Both were followed by a real session before this guard
// existed, and both are the kind of thing that comes back the moment someone
// copies an old hint into a new skill — so the ban is mechanical, not prose.
//
// 1. `printf '[]\n' > data/card-index.json` before the backfill. It does clear
//    pollution, which is why it was written down, but the backfill can only
//    rebuild the ~2000 hand-written rows: the ~1429 `source: "compiled"` rows
//    come from `oracle-index-backfill.ts` and its own Scryfall pass, so the
//    reset deletes them for good. `backfill-card-index.ts --prune` clears
//    pollution and nothing else (it shares `isPollutionEntry` with the guard).
//
// 2. `oracle:corpus --repin` as part of a routine lockfile fix. It takes
//    Scryfall's CURRENT bulk instead of the committed pin, and the compiler's
//    `gaps` are indices into a shared fragment table, so a single new card
//    shifts nearly every index: a 4-line lockfile diff becomes ~50 000 lines of
//    pure renumbering with no semantic change. `oracle:corpus` on its own
//    reproduces the committed pin and verifies its sha256.
//
// The scan targets the files that TELL a human or an agent what to run — guard
// hints and skills — not prose that discusses the hazard. A line is exempt when
// it is warning against the recipe, which is exactly what the replacements do.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";

const ROOT = resolve(__dirname, "..", "..");

/** Tracked files that instruct rather than narrate: the guards that print a fix
 *  command, and the skills an agent follows step by step. */
function instructionFiles(): string[] {
    const out = execFileSync(
        "git",
        ["ls-files", "scripts/*.ts", ".claude/skills/**/*.md"],
        { cwd: ROOT, encoding: "utf8" }
    );
    return out
        .split("\n")
        .filter(Boolean)
        .filter((f) => !f.includes("__tests__"));
}

/** A line that WARNS against a recipe names it in order to forbid it. Detecting
 *  that by wording keeps the guard honest without letting a bare command slip
 *  through: the exemption needs an explicit negative on the same line. */
const FORBIDS = /\b(never|do not|don't|NEVER|do NOT)\b/;

function offendingLines(pattern: RegExp): string[] {
    const hits: string[] = [];
    for (const file of instructionFiles()) {
        const text = readFileSync(join(ROOT, file), "utf8");
        text.split("\n").forEach((line, i) => {
            if (!pattern.test(line)) return;
            if (FORBIDS.test(line)) return;
            hits.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    return hits;
}

describe("destructive data-regeneration recipes stay out of the instructions", () => {
    it("nothing tells you to reset data/card-index.json to [] (it destroys every compiled row)", () => {
        // Matches the reset however it is spelled — `printf`, `echo`, a bare
        // redirect — since what is destructive is the truncation, not the tool.
        const reset = />\s*data\/card-index\.json/;
        expect(
            offendingLines(reset),
            "Use `bun run scripts/backfill-card-index.ts --prune` instead: it removes " +
                "exactly the rows check-card-index.ts calls pollution and keeps every " +
                'source: "compiled" row, which the backfill cannot rebuild.'
        ).toEqual([]);
    });

    it("no guard hint or skill step reaches for oracle:corpus --repin", () => {
        const repin = /oracle[:-]corpus[^\n]*--repin/;
        // `scripts/oracle-corpus.ts` is the flag's HOME: it has to document
        // `--repin` in its usage block and name it in the mismatch error that
        // sends you to the deliberate escape hatch. Banning the string there
        // would ban defining the flag at all. Everywhere else — every guard
        // hint, every skill step — a routine fix must not reach for it.
        const hits = offendingLines(repin).filter(
            (l) => !l.startsWith("scripts/oracle-corpus.ts:")
        );
        expect(
            hits,
            "Plain `bun run oracle:corpus` reproduces the COMMITTED pin and verifies " +
                "its sha256. `--repin` takes today's Scryfall drop, renumbering every " +
                "gap index — a deliberate corpus bump, never part of a routine fix."
        ).toEqual([]);
    });
});
