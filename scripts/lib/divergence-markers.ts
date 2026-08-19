// The divergence-marker scanner — shared by Guard B
// (`convex/cards/__tests__/divergenceMarkers.test.ts`, presence-only, offline)
// and the marker-LIVENESS sweep (`scripts/check-marker-liveness.ts`, resolves
// each referenced issue, network). Issue #2560 extracted this out of a private
// function living inside Guard B's test so the two consumers share one parser
// instead of two that can drift.
//
// Guard B checks that a divergence marker's own comment PARAGRAPH carries a
// tracking disposition (`#NNN` / `tracked-by:` / an explicit "out of scope"
// note) — presence only, never whether the referenced issue is still open.
// The liveness sweep is the other half: it needs to know WHICH issue
// number(s) a marker's paragraph names, so it can ask `gh` whether each is
// still open. `issueNumbersIn` below is the only addition beyond what Guard B
// already had; everything else (the marker/disposition regexes, paragraph
// scoping) is moved verbatim.

import * as fs from "fs";
import * as path from "path";

/** Where Guard B's own scan is scoped — `convex/cards/sets/**` only (issue
 *  #962's original scope; the liveness sweep scans a wider footprint of its
 *  own, see `scripts/check-marker-liveness.ts`). */
export const SETS_DIR = path.resolve("convex/cards/sets");

export const MARKER =
    /\/\/\s*(Deferred|DEFERRED|divergence|DIVERGENCE|not implemented|TODO)\b/i;
// Tracking dispositions. `#NNN` or an explicit out-of-scope note — NOT a bare
// `ADR NNNN` provenance citation (see Guard B's own header comment for why).
export const DISPOSITION = /#\d+|tracked-by:|out[-\s]of[-\s]scope/i;
const IS_COMMENT = /^\s*\/\//;

/** A comment line that ENDS the current paragraph when it sits adjacent to
 *  the marker: a blank `//` separator, or a box-rule line whose only content
 *  is dashes / box-drawing glyphs (`// ─────`, `// ═════`, `// -----`). Both
 *  are the natural paragraph breaks authors already use between a card intro,
 *  its divergence note, and a following section. */
export function isParagraphBreak(line: string): boolean {
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
export function collectSetFiles(root: string): string[] {
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
 *  fixture. */
export function paragraphAround(lines: string[], i: number): string {
    let start = i;
    let end = i;
    while (start > 0 && !isParagraphBreak(lines[start - 1])) start--;
    while (end < lines.length - 1 && !isParagraphBreak(lines[end + 1])) end++;
    return lines.slice(start, end + 1).join("\n");
}

export interface MarkerHit {
    line: number;
    tracked: boolean;
    text: string;
}

/** Every divergence-marker comment line in `lines`, paired with whether its
 *  own comment PARAGRAPH (not the whole contiguous block) carries a tracking
 *  disposition. */
export function scanDivergenceMarkers(lines: string[]): MarkerHit[] {
    const hits: MarkerHit[] = [];
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

/** Every distinct `#NNN` issue number a marker's own paragraph names via an
 *  EXPLICIT `tracked-by: #NNN` — ascending. This is what the LIVENESS sweep
 *  resolves against `gh`; Guard B itself never needs it, only whether the
 *  paragraph names ANY disposition (which also accepts a bare `#NNN` with no
 *  `tracked-by:` prefix — see `DISPOSITION` above).
 *
 *  Deliberately narrower than "every `#NNN` in the paragraph": a bare number
 *  is systematically overloaded in this codebase for things that are NOT a
 *  live tracking claim — a completion citation ("Sacred Boon — ACTIVE
 *  (#734)", `ice/white.ts`, where #734 is the issue that ALREADY SHIPPED the
 *  gap and is closed on purpose), a provenance/history note ("supersedes the
 *  closed #277", `atq/colorless.ts`), a cross-reference to a sibling card's
 *  own (possibly stale) ref. Guard B's own header already ranks these:
 *  "an issue ref (`#NNN`, PREFER `tracked-by: #NNN`)" — `tracked-by:` is the
 *  unambiguous form, so liveness only ever resolves that one. The cost is
 *  under-coverage on a marker using a bare `#NNN` as its sole disposition;
 *  the alternative — resolving every bare number — measured 68 "rotten"
 *  hits on this branch, the great majority false positives from exactly the
 *  three overloaded shapes above, which is worse: a liveness checker that
 *  cries wolf gets ignored on the next real rot. */
function issueNumbersIn(paragraph: string): number[] {
    const trackedBy = new Set<number>();
    for (const m of paragraph.matchAll(/tracked-by:\s*#(\d+)/gi)) {
        trackedBy.add(Number(m[1]));
    }
    return [...trackedBy].sort((a, b) => a - b);
}

export interface MarkerRecord extends MarkerHit {
    file: string;
    /** Issue numbers named in the marker's own paragraph (may be empty — an
     *  "out of scope" disposition or a bare `tracked-by:` names none). */
    issueNumbers: number[];
}

/** `scanDivergenceMarkers` over one file's full text, with `file` and
 *  `issueNumbers` attached — the shape the liveness sweep consumes. */
export function scanText(file: string, text: string): MarkerRecord[] {
    const lines = text.split("\n");
    return scanDivergenceMarkers(lines).map((hit) => ({
        ...hit,
        file,
        issueNumbers: issueNumbersIn(paragraphAround(lines, hit.line - 1)),
    }));
}

/** Convenience: read `file` off disk and scan it. */
export function scanFile(file: string): MarkerRecord[] {
    return scanText(file, fs.readFileSync(file, "utf8"));
}
