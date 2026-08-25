// The divergence-marker scanner — shared by Guard B
// (`convex/cards/__tests__/divergenceMarkers.test.ts`, presence-only, offline)
// and the marker-LIVENESS sweep (`scripts/check-marker-liveness.ts`, resolves
// each referenced issue, network). Issue #2560 extracted this out of a private
// function living inside Guard B's test so the two consumers share one parser
// instead of two that can drift.
//
// Guard B checks that a divergence marker carries a tracking disposition
// (`#NNN` / `tracked-by:` / an explicit "out of scope" note) in its own
// comment line, the line right after it, or an earlier same-paragraph line
// that is itself a dispositioned marker (issue #1900 tightened this from the
// whole paragraph — see `isDispositioned` below) — presence only, never
// whether the referenced issue is still open. The liveness sweep is the
// other half: it needs to know WHICH issue number(s) a marker's paragraph
// names, so it can ask `gh` whether each is still open. `issueNumbersIn`
// below is the only addition beyond what Guard B already had; everything
// else (the marker/disposition regexes, paragraph scoping) is moved
// verbatim.
//
// ── Vocabulary (issue #1900) ────────────────────────────────────────────────
// Guard B's original MARKER (`Deferred`/`divergence`/`not implemented`/
// `TODO`, anchored as the FIRST word after `//`) missed the confession
// vocabulary card authors actually use — `SIMPLIFICATION (flagged)`,
// `approximated by`, `not modelled`, `not enforced`, `deviation`,
// `unimplemented`, `unbuilt` — and almost never as the first word of the
// comment (most per-card divergence prose opens with the card's own name;
// see `scanTrackedByRefs`'s own doc comment below, which hit the identical
// problem for `tracked-by:`). Both were derived empirically off this
// corpus, not guessed from the issue's own examples (a plain grep of just
// those five phrases found only 22 hits against a measured ~200 misses):
// dumping every `//` line matching a wide net of divergence-adjacent English
// (simplif*/approximat*/deviat*/not modelled/not enforced/unbuilt/
// unimplemented/stub/placeholder/no-op/capability gap/…) and reading the
// results by hand. Several candidates were REJECTED after that read because
// they hit sanctioned, non-confession shapes far more than real ones:
// `no-op` (78 hits, almost all ordinary CR 608.2b/107.3 no-op explanations,
// not divergences), `stub`/`placeholder` (219/12, `check-stub-coverage.ts`'s
// domain — commented-out cards, not a shipped card's partial behaviour),
// `best effort`/`capability gap`/`engine gap` (mostly fallback-caller or
// provenance prose, not a card confession). What survived — added below,
// UNANCHORED (a confession word anywhere in a `//` line, not just first) —
// is `simplif\w*`, `approximat\w*`, `not model(l)?ed`, `not enforced`,
// `deviat\w*`, `unimplemented`, `unbuilt`.
//
// UNANCHORING has one cost the anchored version never paid: a comment that
// explicitly DISCLAIMS a divergence ("this is not an approximation of the
// clause, it IS the clause"; "No behavioural divergence"; "Note (not a
// divergence)") now matches `approximat\w*`/`divergence` exactly like a real
// confession, because those two words describe the STATE being denied, not
// only the state being confessed — found empirically, issue #1900 fixup
// round 2, finding 2, after the widened regex forced bogus `tracked-by:`
// dispositions onto four comments that say, in their own words, they are not
// divergences. `isNegatedConfession` below BLANKS only these two words
// (never `not implemented`/`not modelled`/`not enforced`, which are
// themselves two-word confessions — "not" there is part of the vocabulary,
// not a negation of it) when a `not`/`no` sits within 24 characters before
// them on the marker's own line or the line immediately above it (comments
// wrap at ~76 columns, so a negation and its object can straddle one line
// break — `neo/red.ts`'s "so this is not an\n// approximation of the
// clause" is exactly that shape). A repo-wide sweep of every `not|no …
// approximat|divergence` occurrence confirmed this window catches all three
// live confession-disclaiming sites (this one, `usg/red.ts`, `atq/black.ts`)
// plus three PRE-EXISTING ones this PR never touched (`inv/green.ts`,
// `ice/black.ts`, `pls/white.ts` — already correctly undisposed-free because
// they separately carry their own ref) and nothing else: a wider 3-line
// window was tried and rejected because it also swallowed three GENUINE,
// correctly-tracked markers (`mid/white.ts`, `pls/black.ts`,
// `leg/black.ts`) whose nearby "no"/"not" belongs to unrelated prose ("no
// engine event", "no legal choice"), not a negation of the confession.
//
// BLANK-AND-RETEST, not drop-the-hit (issue #1900 fixup round 3, finding 1).
// The round-2 shape dropped the ENTIRE marker hit at `lines[i]` whenever the
// negation window matched anywhere nearby — but a line can carry a genuine,
// independent confession word ALONGSIDE an unrelated "no"/"not …
// divergence/approximat*" phrase that isn't negating it at all ("Deferred:
// no Op models this divergence yet, so the clause is dropped" — "no Op
// models this divergence" trips the window, but "Deferred" is its own,
// unnegated confession). Blanking only the matched negated span and
// re-testing `MARKER` against what's left fixes this: an independent
// confession elsewhere on the line still counts, and a line whose ONLY
// confession word was the negated one still gets suppressed.

import * as fs from "fs";
import * as path from "path";

/** Where Guard B's own scan is scoped — `convex/cards/sets/**` only (issue
 *  #962's original scope; the liveness sweep scans a wider footprint of its
 *  own, see `scripts/check-marker-liveness.ts`). */
export const SETS_DIR = path.resolve("convex/cards/sets");

export const MARKER =
    /\/\/.*\b(Deferred|divergence|not implemented|TODO|simplif\w*|approximat\w*|not model(?:l)?ed|not enforced|deviat\w*|unimplemented|unbuilt)\b/i;
// Tracking dispositions. `#NNN` or an explicit out-of-scope note — NOT a bare
// `ADR NNNN` provenance citation (see Guard B's own header comment for why).
export const DISPOSITION = /#\d+|tracked-by:|out[-\s]of[-\s]scope/i;
const IS_COMMENT = /^\s*\/\//;

/** Same anchor `check-stub-coverage.ts` uses to identify a commented-out card
 *  definition — duplicated rather than imported: that module's top level
 *  runs `getAllCards()` to build its dead-duplicate index, so importing
 *  anything from it would pull in the whole card registry just for a regex
 *  constant. If `STUB_ANCHOR` ever changes there, mirror the edit here.
 *  (Moved here from `scripts/check-marker-liveness.ts` in issue #1900 so
 *  Guard B's OWN scan can suppress stub context too — the widened MARKER
 *  vocabulary otherwise lands inside commented-out-stub section prose, e.g.
 *  the `#676`/`#679`/`#684` sites in `mh1/`, which is `check-stub-coverage.ts`'s
 *  domain, not Guard B's: Guard B's header above is explicit that it polices
 *  an ACTIVE card's documented partial implementation, never a commented-out
 *  one.) */
export const STUB_ANCHOR =
    /^\s*\/\/\s*export const\s+[A-Za-z0-9_]+\s*(?::\s*(?:CardDefinition|CardPrint)\b|=\s*[A-Za-z_][A-Za-z0-9_]*\s*\()/;

/** True when `lines[i]` sits in the same contiguous `//` comment run as a
 *  commented-out card-definition stub anchor. Walks the whole contiguous run
 *  in both directions, wider than Guard B's paragraph window, because a
 *  stub's own tracking note can sit above OR below its anchor and the run is
 *  not always paragraph-broken from it. */
export function isStubContext(lines: string[], i: number): boolean {
    let start = i;
    while (start > 0 && IS_COMMENT.test(lines[start - 1])) start--;
    let end = i;
    while (end < lines.length - 1 && IS_COMMENT.test(lines[end + 1])) end++;
    for (let k = start; k <= end; k++) {
        if (STUB_ANCHOR.test(lines[k])) return true;
    }
    return false;
}

/** Negates only the two confession words whose own text describes the STATE
 *  being denied (`approximat\w*`, `divergence`) — never `not implemented` /
 *  `not modelled` / `not enforced`, which are themselves two-word confession
 *  phrases where "not" IS the vocabulary, not a negation of it. See the
 *  module note above ("UNANCHORING has one cost…") for the corpus sweep that
 *  picked the 24-character window and the two-line (not three-line) span. */
export const NEGATED_CONFESSION =
    /\b(?:not|no)\b.{0,24}?\b(?:approximat\w*|divergence)\b/i;

const strip = (line: string) => line.replace(/^\s*\/\/\s?/, "");

/** Blanks every NEGATED-CONFESSION span that falls (even partially) on
 *  `line` — the marker candidate's own line — leaving every OTHER word,
 *  including an unrelated, un-negated confession elsewhere on the same
 *  line, untouched. Matches against `prevLine + " " + line` (comment
 *  prefixes stripped from both) so a negation split across the wrapped-
 *  comment boundary (`neo/red.ts`'s "so this is not an\n// approximation of
 *  the clause") is still caught, but only the portion of each match that
 *  actually lands on `line` gets blanked — the negation cue itself can live
 *  entirely on `prevLine` and still consume its object on `line`. Exported
 *  for direct unit testing (issue #1900 fixup round 3, finding 1). */
export function blankNegatedConfessions(
    prevLine: string,
    line: string
): string {
    const prevBody = strip(prevLine);
    const body = strip(line);
    const boundary = prevBody.length + 1; // +1 for the joining space
    const joined = `${prevBody} ${body}`;
    // Capture the negated OBJECT (`approximation`/`divergence`) so only that
    // word is blanked, never the whole `not … <object>` span: a confession
    // word sitting BETWEEN the cue and its object ("not implemented; the
    // divergence stands") must survive, or Guard B loses coverage it has on
    // main. Round-3 review finding, issue #1900.
    const re = new RegExp(
        NEGATED_CONFESSION.source.replace(
            "(?:approximat\\w*|divergence)",
            "((?:approximat\\w*|divergence))"
        ),
        "gi"
    );
    let blanked = body;
    let m: RegExpExecArray | null;
    while ((m = re.exec(joined)) !== null) {
        const matchEnd = m.index + m[0].length;
        const matchStart = matchEnd - (m[1]?.length ?? 0);
        const start = Math.max(matchStart, boundary) - boundary;
        const end = Math.max(matchEnd, boundary) - boundary;
        if (end > start) {
            blanked =
                blanked.slice(0, start) +
                " ".repeat(end - start) +
                blanked.slice(end);
        }
    }
    return blanked;
}

/** True when the marker candidate at `lines[i]` should be suppressed as a
 *  DISCLAIMED divergence/approximation rather than counted as a confession.
 *  Blanks the negated span(s) via `blankNegatedConfessions` and re-tests
 *  `MARKER` on what remains of `lines[i]` — `true` (suppress) only when NO
 *  confession word survives the blanking, so a line carrying an independent,
 *  unnegated confession word alongside the negated one still counts as a
 *  hit ("Deferred: no Op models this divergence yet, so the clause is
 *  dropped" — the negation window matches "no Op models this divergence",
 *  but "Deferred" is untouched and still trips `MARKER`). Round-2 shape
 *  dropped the whole hit on any nearby negation match; this is the fix
 *  (issue #1900 fixup round 3, finding 1). */
export function isNegatedConfession(lines: string[], i: number): boolean {
    const prev = i > 0 ? lines[i - 1] : "";
    const blanked = blankNegatedConfessions(prev, lines[i]);
    return !MARKER.test(`// ${blanked}`);
}

/** Anchor for the sanctioned `aiEffects`/AI-valuation shadow-script idiom
 *  (PRD #1423, issue #1431/#1519/#2364 — see any of the ~15 sites using it,
 *  e.g. `mh1/blue.ts`, `pls/blue.ts`). A shadow script is an intentional,
 *  DOCUMENTED approximation of a card's effect for the bot's valuer only —
 *  it never changes actual game behaviour — so a confession word inside its
 *  own paragraph (`big/green.ts`'s "Approximates the real effect closely
 *  enough for valuation") is not a Guard-B divergence at all, the same way a
 *  commented-out card stub is `check-stub-coverage.ts`'s domain and not
 *  Guard B's (issue #1900 fixup round 2, finding 2: the widened vocabulary
 *  landed a bogus `tracked-by:` on this sanctioned prose because it happens
 *  to contain "Approximates" — the fix is to stop matching the context, not
 *  to disposition it). Only this one site currently trips it: the other
 *  aiEffects sites document their approximation without a MARKER word. */
export const AI_EFFECTS_SHADOW_ANCHOR = /\baiEffects\b\s*\(PRD #1423/i;

/** True when `lines[i]` sits in the same contiguous `//` comment run as an
 *  `aiEffects` shadow-script anchor — same walk shape as `isStubContext`. */
export function isAiEffectsShadowContext(lines: string[], i: number): boolean {
    let start = i;
    while (start > 0 && IS_COMMENT.test(lines[start - 1])) start--;
    let end = i;
    while (end < lines.length - 1 && IS_COMMENT.test(lines[end + 1])) end++;
    for (let k = start; k <= end; k++) {
        if (AI_EFFECTS_SHADOW_ANCHOR.test(lines[k])) return true;
    }
    return false;
}

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

/** Start/end line indices (inclusive) of the comment PARAGRAPH containing
 *  line `i`: expand up and down while the adjacent line is neither a
 *  paragraph break nor a non-comment line. */
function paragraphBounds(
    lines: string[],
    i: number
): { start: number; end: number } {
    let start = i;
    let end = i;
    while (start > 0 && !isParagraphBreak(lines[start - 1])) start--;
    while (end < lines.length - 1 && !isParagraphBreak(lines[end + 1])) end++;
    return { start, end };
}

/** The comment PARAGRAPH containing line `i`, joined as text. Pure function
 *  of `lines` (no disk I/O) so it can be unit-tested against a fixture. Used
 *  only for `issueNumbers` extraction (liveness) — Guard B's own tracking
 *  check uses the tighter `isDispositioned` window below (issue #1900). */
export function paragraphAround(lines: string[], i: number): string {
    const { start, end } = paragraphBounds(lines, i);
    return lines.slice(start, end + 1).join("\n");
}

/** Whether the marker at line `i` carries its own tracking disposition —
 *  TIGHTENED WINDOW (issue #1900). Accepts:
 *    1. a disposition on the marker's OWN line;
 *    2. a disposition on the line immediately following it, still within
 *       the same paragraph;
 *    3. a disposition on an EARLIER line of the same paragraph that is
 *       ITSELF a marker line carrying its own (case 1) disposition — the
 *       "shared section-footer header" shape: a single
 *       `// C5 deferred (tracked-by: #NNNN) — …` line vouches for the
 *       marker-word bullets listed underneath it in the same paragraph.
 *       (`#NNNN` here is a placeholder, not a real issue number — this file
 *       is itself in-scope tracked source for the liveness sweep, and a
 *       real, resolvable `#NNN` in this example would register as a live
 *       `tracked-by:` ref that later rots when that issue closes; see the
 *       identical hazard called out in `scanTrackedByRefs`'s own doc
 *       comment below, which splits its `#1324` example across two
 *       literals for the same reason.)
 *  This is narrower than the old whole-paragraph scan: an UNRELATED ref
 *  sitting in a different sentence of the same paragraph (a provenance
 *  citation, a separate deferral's own ref) no longer vouches for a marker
 *  it isn't attached to — issue #1900's "same-paragraph vouching" leak
 *  (`eld/colorless.ts`'s Fabled Passage, since fixed on its merits, was the
 *  original repro). */
function isDispositioned(lines: string[], i: number): boolean {
    if (DISPOSITION.test(lines[i])) return true;
    const { start, end } = paragraphBounds(lines, i);
    if (i + 1 <= end && DISPOSITION.test(lines[i + 1])) return true;
    for (let j = start; j < i; j++) {
        if (MARKER.test(lines[j]) && DISPOSITION.test(lines[j])) return true;
    }
    return false;
}

export interface MarkerHit {
    line: number;
    tracked: boolean;
    text: string;
}

/** Every divergence-marker comment line in `lines`, paired with whether it
 *  carries a tracking disposition per `isDispositioned`'s tightened window.
 *  Three classes of non-marker are skipped entirely before a hit is ever
 *  recorded: a commented-out card stub's comment run (`check-stub-coverage.ts`'s
 *  domain, not Guard B's), a comment explicitly DISCLAIMING a divergence/
 *  approximation rather than confessing one (`isNegatedConfession`), and the
 *  sanctioned `aiEffects` shadow-script idiom (`isAiEffectsShadowContext`). */
export function scanDivergenceMarkers(lines: string[]): MarkerHit[] {
    const hits: MarkerHit[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (!MARKER.test(lines[i])) continue;
        if (isStubContext(lines, i)) continue;
        if (isNegatedConfession(lines, i)) continue;
        if (isAiEffectsShadowContext(lines, i)) continue;
        hits.push({
            line: i + 1,
            tracked: isDispositioned(lines, i),
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

// ── Liveness-only: widened beyond Guard B's MARKER-word gate ───────────────
//
// Everything above this line is Guard B's own parser (presence-only,
// MARKER-word-anchored) and stays untouched — `divergenceMarkers.test.ts`
// depends on it byte-for-byte. `scanTrackedByRefs` below is a SEPARATE, wider
// scan the liveness sweep alone uses (issue #2560 fixup round 1, finding 1):
// measured on `6adb6189`, `scanText`'s MARKER-word requirement (`// Deferred
// | divergence | not implemented | TODO`) resolved only 31 of 104 in-scope
// `tracked-by: #NNN` refs, because most per-card divergence paragraphs in
// this repo open with the CARD's name ("// Atalya, Samite Master — …"), never
// a marker word — and several live inside a `/** … */` JSDoc block
// (`convex/cards/types.ts`, `convex/limited/eventTypes.ts`,
// `src/lib/deckViewPrefs.ts`), which `scanText`'s `//`-only paragraph walk
// (`isParagraphBreak`) cannot enter at all.
//
// `tracked-by:` is itself the disposition (Guard B's own header: "PREFER
// `tracked-by: #NNN`") — it does not need a marker word next to it to be a
// live tracking promise, so liveness resolves it wherever a comment can
// carry it: a `//` line, or an `/*`/`/**`/` * ` block-comment line.
//
// Per-line, WITH ONE FOLD: a `tracked-by:` line already names its own
// number(s) in the overwhelming majority of cases, but a hand-wrapped
// comment can still split `tracked-by:` from its `#NNN` across the line
// break (`// … (tracked-by:\n// #675):`) — the same shape `cr:lint` names as
// its own blind spot (CLAUDE.md § Rules Implementation Process: "a citation
// wrapped across two comment lines"). Measured in fixup round 2 (issue
// #2560): 6 real sites wrapped this way, one of them (`5dn/colorless.ts`)
// naming a CLOSED issue that a per-line-only scan could not see — the exact
// auto-close-a-still-referenced-umbrella failure this sweep exists to catch.
// So a line whose OWN text ends in a bare `tracked-by:` is folded with the
// next comment line before matching, dropping that line's own `//`/`/*`/`*`
// prefix first (else the fold string still reads "tracked-by: // #675" and
// the immediately-following-`#` match fails). `TRACKED_BY_G` also accepts an
// optional, ANCHORED `tolaria` literal between the colon and the number — a
// prefixed-repo-slug form (`woe/colorless.ts`'s `TODO(tracked-by: tolaria` +
// `#1324)`) the plain `#NNN` shape missed even on a single line. Anchored,
// not a bare word: every referenced issue in this sweep is same-repo (`gh
// issue view` below resolves against this repo only), so a DIFFERENT
// prefix — `tracked-by: otherrepo#12`, `tracked-by: v2#5` — is a foreign
// ref this scanner cannot check and must not silently misresolve as local
// issue 12 or 5; it now falls through unmatched instead (round 3 fix, issue
// #2560 — the prior `[A-Za-z][\w.-]*` accepted ANY bare word, so a foreign
// ref reported confident nonsense about a same-numbered local issue). A
// slash-qualified form (`acme/otherrepo#12`) already fell through before
// this change and still does — no live site uses one. (Written split across
// two literals right here on purpose — this file is itself in-scope tracked
// source, and an unbroken example would register as a live marker on ITSELF.)
//
// KNOWN FALSE POSITIVE (pinned by a test, not fixed — issue #2560 fixup
// round 3, finding 1): the fold triggers on ANY comment line ending in the
// literal words "tracked-by:", not only a genuine wrapped reference —
// `TRACKED_BY_TAIL` cannot tell "nothing is tracked-by:" (ordinary prose)
// from a real wrap, and the guard only checks that the FOLLOWING line is A
// comment, not that it continues the same clause. So:
//   // no live ticket; nothing is tracked-by:
//   // #4242 was closed as a duplicate.
// folds to `[[4242]]` today, attributing an unrelated issue number as this
// paragraph's tracking ref. Zero instances of this shape existed in the
// repo when this was found (grepped across every `tracked-by:`-adjacent
// comment); if that changes, tighten `TRACKED_BY_TAIL` (e.g. require the
// tail to follow an opening paren/bracket rather than bare prose) instead
// of widening the guard further.
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;
const COMMENT_PREFIX = /^\s*(\/\/|\/\*\*?|\*)\s*/;
const TRACKED_BY_TAIL = /tracked-by:\s*$/i;
const TRACKED_BY_G = /tracked-by:\s*(?:tolaria)?#(\d+)/gi;

// Issue #1841: a second live-ref SYNTAX, resolved by the SAME function and
// filtered by the SAME `isStubContext` caller. A `TODO(issue #NNN…)` note
// (`convex/cards/sets/dsk/red.ts`, `mh3/colorless.ts`, prior to this issue's
// own fix) named a live-tracking disposition — Guard B's own `DISPOSITION`
// regex already accepted it presence-only — but `scanTrackedByRefs` only
// ever resolved `tracked-by:`, so a closed issue behind this syntax
// satisfied `markers:lint` silently. 26 of the 29 sites using this syntax
// sit inside commented-out card stubs (`check-stub-coverage.ts`'s domain,
// e.g. `mh1/white.ts:79`'s own such note directly above a commented-out
// `export const windsOfAbandon…`) — those stay excluded exactly as before
// via `isStubContext` in `scripts/check-marker-liveness.ts`, which walks the
// contiguous `//` run independent of which regex produced the record. The
// number always sits on the same line as the `TODO(issue` opener at every
// site found in this repo, so this regex itself never folds across a line
// break — but it is matched against `scanned` below, which `tracked-by:`
// folding may already have widened to include the FOLLOWING line's text. A
// line ending in a bare `tracked-by:` immediately followed by a
// `// TODO(issue #NNNN)` line would attribute NNNN to both lines (the
// tracked-by: line via the fold, and its own line via the normal per-line
// scan) — over-reporting only, never under-reporting, and no such site
// exists in this repo today.
const TODO_ISSUE_G = /TODO\(\s*issue\s*#(\d+)/gi;

/** Every explicit `tracked-by: #NNN` OR `TODO(issue #NNN…` occurrence on a
 *  comment line of `text` (`//`, `/*`, `/**` or a ` * ` JSDoc continuation)
 *  — independent of any MARKER word. One record per LINE naming at least one
 *  number, numbers deduped/ascending. A line ending in a bare `tracked-by:`
 *  is folded with the following comment line before matching (see the module
 *  note above) — `TODO(issue #NNN` never triggers a fold of its own, but a
 *  `tracked-by:`-triggered fold can still carry a following `TODO(issue #N)`
 *  line's number into the folded line's result too (see `TODO_ISSUE_G`'s own
 *  comment: over-reporting only, no live site today). Liveness-only; Guard B
 *  never calls this. */
export function scanTrackedByRefs(file: string, text: string): MarkerRecord[] {
    const lines = text.split("\n");
    const out: MarkerRecord[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!COMMENT_LINE.test(line)) continue;
        let scanned = line;
        if (
            TRACKED_BY_TAIL.test(line) &&
            i + 1 < lines.length &&
            COMMENT_LINE.test(lines[i + 1])
        ) {
            scanned = `${line} ${lines[i + 1].replace(COMMENT_PREFIX, "")}`;
        }
        const numbers = new Set<number>();
        for (const m of scanned.matchAll(TRACKED_BY_G))
            numbers.add(Number(m[1]));
        for (const m of scanned.matchAll(TODO_ISSUE_G))
            numbers.add(Number(m[1]));
        if (numbers.size === 0) continue;
        out.push({
            file,
            line: i + 1,
            tracked: true,
            text: line.trim(),
            issueNumbers: [...numbers].sort((a, b) => a - b),
        });
    }
    return out;
}
