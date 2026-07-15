// Guard B — documented-divergence-needs-issue (issue #962). Root-cause fix
// for the "silently-partial" anti-pattern: a card whose `resolve()`/`effects`
// silently drops an Oracle clause behind a `// Deferred` / `// divergence` /
// `// not implemented` / `// TODO` comment with NO linked tracking issue.
//
// Sibling to `scripts/check-stub-coverage.ts` (the commented-STUB guard) —
// same disposition-scan shape, but for an ACTIVE card's documented partial
// implementation rather than a commented-out card. Stub-coverage catches an
// untracked commented-out card; this guard catches an untracked partial
// implementation of a SHIPPED one.
//
// Scan: every `.ts` file under `convex/cards/sets/**` (excluding `__tests__`
// and `*.test.ts`), looking for a divergence-marker comment line
// (`Deferred`/`DEFERRED`/`divergence`/`DIVERGENCE`/`not implemented`/`TODO`).
// Each marker's CONTIGUOUS COMMENT BLOCK — walking up/down while the
// adjacent line is also a `//` comment, the exact windowing
// `check-stub-coverage.ts` uses for its own disposition scan — must carry a
// disposition: a linked issue ref (`#\d+`), an ADR reference (`ADR \d+`), or
// an explicit "out of scope" note. Those are the same three dispositions the
// sibling stub guard accepts, so a permanently out-of-scope divergence (an
// ante card, say) doesn't need an invented issue number.

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SETS_DIR = path.resolve("convex/cards/sets");

const MARKER =
    /\/\/\s*(Deferred|DEFERRED|divergence|DIVERGENCE|not implemented|TODO)\b/i;
const DISPOSITION = /#\d+|ADR\s*\d+|out[-\s]of[-\s]scope/i;
const IS_COMMENT = /^\s*\/\//;

/** Collect every `.ts` source file under a colour-split set directory
 *  (`sets/<code>/<colour>.ts`, ADR 0043), excluding `__tests__` and
 *  `*.test.ts` — recurses so it also picks up a legacy flat `sets/<code>.ts`
 *  file if one exists, mirroring `scripts/check-stub-coverage.ts`'s own
 *  file collector. */
function collectSetFiles(root: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.name === "__tests__") continue;
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectSetFiles(full));
        } else if (
            entry.name.endsWith(".ts") &&
            !entry.name.endsWith(".test.ts")
        ) {
            out.push(full);
        }
    }
    return out;
}

/** Every divergence-marker comment line in `lines`, paired with whether its
 *  CONTIGUOUS comment block (walking up/down while adjacent lines are also
 *  `//` comments) carries a disposition. A pure function of `lines` (no disk
 *  I/O) so it can be unit-tested against a fixture — see the sanity test
 *  below. */
function scanDivergenceMarkers(
    lines: string[]
): Array<{ line: number; tracked: boolean; text: string }> {
    const hits: Array<{ line: number; tracked: boolean; text: string }> = [];
    for (let i = 0; i < lines.length; i++) {
        if (!MARKER.test(lines[i])) continue;
        let start = i;
        let end = i;
        while (start > 0 && IS_COMMENT.test(lines[start - 1])) start--;
        while (end < lines.length - 1 && IS_COMMENT.test(lines[end + 1])) end++;
        const block = lines.slice(start, end + 1).join("\n");
        hits.push({
            line: i + 1,
            tracked: DISPOSITION.test(block),
            text: lines[i].trim(),
        });
    }
    return hits;
}

describe("Guard B — documented-divergence-needs-issue (issue #962)", () => {
    it("every divergence marker (Deferred/divergence/not implemented/TODO) in convex/cards/sets/** carries a linked disposition", () => {
        const offenders: string[] = [];
        for (const file of collectSetFiles(SETS_DIR)) {
            const lines = fs.readFileSync(file, "utf8").split("\n");
            for (const hit of scanDivergenceMarkers(lines)) {
                if (!hit.tracked) {
                    offenders.push(
                        `${path.relative(SETS_DIR, file)}:${hit.line}: ${hit.text}`
                    );
                }
            }
        }
        expect(
            offenders,
            "divergence markers with no linked issue (#NNN), ADR reference, or explicit " +
                "'out of scope' note anywhere in their comment block — every intentional " +
                "partial/deferred clause must be tracked (see .claude/rules/gre-development.md " +
                "§ stop-and-issue). Either add a `tracked-by: #NNN` ref, or open a new issue " +
                "and reference it."
        ).toEqual([]);
    });

    it("sanity: the scanner rejects an untracked marker and accepts issue/ADR/out-of-scope dispositions", () => {
        const untracked = [
            "// some card doc",
            "// DEFERRED: this thing is not built yet, no ref here",
            "export const foo = 1;",
        ];
        const issueTracked = [
            "// some card doc",
            "// DEFERRED (tracked-by: #123): this thing is not built yet",
            "export const foo = 1;",
        ];
        const adrTracked = [
            "// DEFERRED — permanently out of scope (ADR 0010)",
            "export const bar = 1;",
        ];
        const outOfScopeTracked = [
            "// TODO: out of scope — ante mechanics are never built",
            "export const baz = 1;",
        ];

        const untrackedHits = scanDivergenceMarkers(untracked);
        expect(untrackedHits).toHaveLength(1);
        expect(untrackedHits[0].tracked).toBe(false);

        expect(scanDivergenceMarkers(issueTracked)[0].tracked).toBe(true);
        expect(scanDivergenceMarkers(adrTracked)[0].tracked).toBe(true);
        expect(scanDivergenceMarkers(outOfScopeTracked)[0].tracked).toBe(true);
    });

    it("a multi-line comment block links a disposition declared on a DIFFERENT line than the marker itself", () => {
        const block = [
            "// TODO: this card's second ability is deferred because the engine",
            "// lacks a primitive for it. See issue #4242 for the tracking ticket.",
            "export const someCard = 1;",
        ];
        const hits = scanDivergenceMarkers(block);
        expect(hits).toHaveLength(1);
        expect(hits[0].tracked).toBe(true);
    });

    it("finds a non-zero number of documented markers (the guard is actually scanning something)", () => {
        let total = 0;
        for (const file of collectSetFiles(SETS_DIR)) {
            const lines = fs.readFileSync(file, "utf8").split("\n");
            total += scanDivergenceMarkers(lines).length;
        }
        expect(total).toBeGreaterThan(0);
    });
});
