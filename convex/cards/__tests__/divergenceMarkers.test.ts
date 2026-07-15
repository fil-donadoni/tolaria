// Guard B — documented-divergence-needs-issue (issue #962). Root-cause fix
// for the "silently-partial" anti-pattern: a card whose `resolve()`/`effects`
// silently drops an Oracle clause behind a `// Deferred` / `// divergence` /
// `// not implemented` / `// TODO` comment with NO linked tracking issue.
//
// Sibling to `scripts/check-stub-coverage.ts` (the commented-STUB guard) —
// same disposition-scan intent, but for an ACTIVE card's documented partial
// implementation rather than a commented-out card. Stub-coverage catches an
// untracked commented-out card; this guard catches an untracked partial
// implementation of a SHIPPED one.
//
// Scan: every `.ts` file under `convex/cards/sets/**` (excluding `__tests__`
// and `*.test.ts`), looking for a divergence-marker comment line
// (`Deferred`/`DEFERRED`/`divergence`/`DIVERGENCE`/`not implemented`/`TODO`).
//
// WINDOW — the marker's own comment PARAGRAPH, not the whole contiguous
// comment block (issue #962 review). A "paragraph" is the run of comment
// lines around the marker, bounded by a blank `//` separator line, a
// box-rule line (`// ────` / `// ════`), or any non-comment line. Walking
// the ENTIRE contiguous block (the first cut) let a marker be vouched for by
// ANY unrelated ref ANYWHERE in the block — a provenance citation in the card
// intro above, or a SEPARATE deferral note's ref below. Two proven leaks that
// closed by paragraph-scoping:
//   • a `// DEFERRED …` planted at the foot of a card doc paragraph that ends
//     `…(ADR 0004 authoritative).` — the provenance ADR absorbed it;
//   • `arn/colorless.ts` — a genuine untracked "Deferred to later batches"
//     list vouched for only by a separate `// Out of scope — ante` note lower
//     in the same block.
// A real multi-marker note (e.g. a section footer that lists several deferred
// cards under one `tracked-by: #NNN` header, with the word "deferred"
// recurring in its bullets) is ONE paragraph and needs the ref only once.
//
// DISPOSITION — a linked issue ref (`#NNN`, prefer `tracked-by: #NNN`) or an
// explicit "out of scope" note. An `ADR NNNN` citation does NOT count: an ADR
// documents a card's DESIGN/provenance, it is not a tracking reference for a
// dropped clause (a permanently out-of-scope divergence still says so in
// words — "out of scope" — which does count). This is deliberately STRICTER
// than `check-stub-coverage.ts`'s disposition set, because a divergence on a
// SHIPPED card is a live gap that wants a work issue, not a design citation.

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SETS_DIR = path.resolve("convex/cards/sets");

const MARKER =
    /\/\/\s*(Deferred|DEFERRED|divergence|DIVERGENCE|not implemented|TODO)\b/i;
// Tracking dispositions. `#NNN` or an explicit out-of-scope note — NOT a bare
// `ADR NNNN` provenance citation (see header).
const DISPOSITION = /#\d+|tracked-by:|out[-\s]of[-\s]scope/i;
const IS_COMMENT = /^\s*\/\//;

/** A comment line that ENDS the current paragraph when it sits adjacent to
 *  the marker: a blank `//` separator, or a box-rule line whose only content
 *  is dashes / box-drawing glyphs (`// ─────`, `// ═════`, `// -----`). Both
 *  are the natural paragraph breaks authors already use between a card intro,
 *  its divergence note, and a following section. */
function isParagraphBreak(line: string): boolean {
    if (!IS_COMMENT.test(line)) return true; // non-comment ends the paragraph
    const body = line.replace(/^\s*\/\/\s?/, "").trim();
    if (body === "") return true; // blank `//`
    // Rule line: nothing but dashes / underscores / box-drawing characters.
    return /^[\s─-╿=\-_]+$/.test(body);
}

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

/** The comment PARAGRAPH containing line `i`: expand up and down while the
 *  adjacent line is neither a paragraph break nor a non-comment line. Pure
 *  function of `lines` (no disk I/O) so it can be unit-tested against a
 *  fixture — see the regression tests below. */
function paragraphAround(lines: string[], i: number): string {
    let start = i;
    let end = i;
    while (start > 0 && !isParagraphBreak(lines[start - 1])) start--;
    while (end < lines.length - 1 && !isParagraphBreak(lines[end + 1])) end++;
    return lines.slice(start, end + 1).join("\n");
}

/** Every divergence-marker comment line in `lines`, paired with whether its
 *  own comment PARAGRAPH (not the whole contiguous block) carries a tracking
 *  disposition. */
function scanDivergenceMarkers(
    lines: string[]
): Array<{ line: number; tracked: boolean; text: string }> {
    const hits: Array<{ line: number; tracked: boolean; text: string }> = [];
    for (let i = 0; i < lines.length; i++) {
        if (!MARKER.test(lines[i])) continue;
        hits.push({
            line: i + 1,
            tracked: DISPOSITION.test(paragraphAround(lines, i)),
            text: lines[i].trim(),
        });
    }
    return hits;
}

describe("Guard B — documented-divergence-needs-issue (issue #962)", () => {
    it("every divergence marker (Deferred/divergence/not implemented/TODO) in convex/cards/sets/** carries a linked disposition in its own paragraph", () => {
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
            "divergence markers with no linked issue (#NNN / tracked-by:) or explicit " +
                "'out of scope' note in their OWN comment paragraph — every intentional " +
                "partial/deferred clause must be tracked (see .claude/rules/gre-development.md " +
                "§ Guard B). A ref in a separate paragraph (a card-intro provenance citation, or " +
                "another deferral note in the same block) does NOT count. Add a `tracked-by: #NNN` " +
                "ref on/next to the marker, or open a new issue and reference it."
        ).toEqual([]);
    });

    it("sanity: the scanner rejects an untracked marker and accepts issue / tracked-by / out-of-scope dispositions", () => {
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
        const outOfScopeTracked = [
            "// TODO: out of scope — ante mechanics are never built",
            "export const baz = 1;",
        ];

        const untrackedHits = scanDivergenceMarkers(untracked);
        expect(untrackedHits).toHaveLength(1);
        expect(untrackedHits[0].tracked).toBe(false);

        expect(scanDivergenceMarkers(issueTracked)[0].tracked).toBe(true);
        expect(scanDivergenceMarkers(outOfScopeTracked)[0].tracked).toBe(true);
    });

    it("a multi-line divergence note links a disposition declared on a DIFFERENT line of the SAME paragraph", () => {
        const block = [
            "// TODO: this card's second ability is deferred because the engine",
            "// lacks a primitive for it. See issue #4242 for the tracking ticket.",
            "export const someCard = 1;",
        ];
        const hits = scanDivergenceMarkers(block);
        expect(hits).toHaveLength(1);
        expect(hits[0].tracked).toBe(true);
    });

    // --- Regression: the block-absorption hole this tightening closes -------
    // (issue #962 review). Each fixture WOULD have passed the first, whole-block
    // scan and now correctly REDS, because the only ref lives in a SEPARATE
    // paragraph than the marker.

    it("regression: a marker is NOT vouched for by a provenance ref in the card-intro paragraph above (blank-line separated)", () => {
        const block = [
            "// Foo — draws a card, then does bar. Migrated in #833 (ADR 0004).",
            "//",
            "// DEFERRED: the second, conditional clause is not built yet.",
            "export const foo = 1;",
        ];
        const hits = scanDivergenceMarkers(block);
        expect(hits).toHaveLength(1);
        // The #833 / ADR 0004 above is a DIFFERENT paragraph — must not vouch.
        expect(hits[0].tracked).toBe(false);
    });

    it("regression: a bare ADR provenance citation adjacent to the marker does NOT count as a tracking ref", () => {
        const block = [
            "// DEFERRED: the anti-redirection rider is unbuilt (design per ADR 0004).",
            "export const foo = 1;",
        ];
        const hits = scanDivergenceMarkers(block);
        expect(hits).toHaveLength(1);
        expect(hits[0].tracked).toBe(false);
    });

    it("regression: a marker is NOT vouched for by a separate deferral note's ref lower in the same contiguous block", () => {
        // The arn/colorless.ts shape: an untracked 'Deferred to later batches'
        // note, then a blank `//`, then a separate 'Out of scope' note. The
        // whole-block scan absorbed the lower note's disposition; paragraph
        // scoping keeps them independent.
        const block = [
            "// ─────────────────────────────────────────────",
            "// Deferred to later batches — needs unbuilt engine work:",
            "//   • Card A — needs primitive X.",
            "//",
            "// Out of scope — ante / subgames (ADR 0010): Card B.",
            "// ─────────────────────────────────────────────",
        ];
        const hits = scanDivergenceMarkers(block);
        // Only the first line matches MARKER ('Deferred'); it must RED.
        expect(hits).toHaveLength(1);
        expect(hits[0].line).toBe(2);
        expect(hits[0].tracked).toBe(false);
    });

    it("regression: a box-rule line separates paragraphs so a ref beyond it does not leak in", () => {
        const block = [
            "// DEFERRED: clause two is unbuilt.",
            "// ═════════════════════════════════",
            "// Some later section, tracked-by: #999.",
        ];
        const hits = scanDivergenceMarkers(block);
        expect(hits).toHaveLength(1);
        expect(hits[0].tracked).toBe(false);
    });

    it("a real multi-marker section footer needs its tracking ref only once (recurring 'deferred' word in bullets under one header)", () => {
        const block = [
            "// ─────────────────────────────────────────────",
            "// C5 deferred (tracked-by: #1213) — counter cards owned by a later cluster:",
            "//   • Card A — needs a targeting feature, so it is",
            "//     deferred whole to avoid a partial card.",
            "//   • Card B — needs a board-computed cost. It is",
            "//     Deferred whole rather than shipped wrong.",
            "// ─────────────────────────────────────────────",
        ];
        // Several continuation lines START with a marker word (the real
        // leg/black.ts C5-footer shape), but they are ONE paragraph under the
        // single #1213 header — all tracked, ref needed only once.
        const hits = scanDivergenceMarkers(block);
        expect(hits.length).toBeGreaterThanOrEqual(2);
        for (const h of hits) expect(h.tracked).toBe(true);
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
