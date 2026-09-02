// The `compiler-gap:` marker scanner — Guard C's half of the marker family
// (issue #2701, PRD #2693).
//
// Guard A polices a keyword a card DECLARES but the engine does not implement.
// Guard B polices a clause a card's author knowingly DROPPED. Guard C polices
// the third gap, the one the Oracle compiler introduced: a hand-written card
// whose own Oracle text the compiler cannot read back into that same
// definition. A contributor may not leave the compiler behind silently — either
// the card round-trips, or its author names the exact fragment the grammar
// cannot consume, so that fragment joins the backlog the corpus report ranks
// the next grammar rule by (PRD #2693 user story 9).
//
// ── The marker ─────────────────────────────────────────────────────────────
//
//   // compiler-gap: <fragment> (#issue)
//
// STRICT by design. A loose form (`compiler-gap:` with no ref, or with the ref
// on the next line) would exempt the card while contributing nothing to the
// backlog, and a typo would silently fail to exempt it — which is the WORST
// outcome, because the author then sees "does not round-trip" and no hint that
// their marker was the problem. So a `compiler-gap:` line that does not match
// {@link COMPILER_GAP} is reported as MALFORMED and reds on its own, separately
// from the round-trip failure it was meant to explain.
//
// ── Attachment ─────────────────────────────────────────────────────────────
//
// A marker vouches for exactly ONE card: the one whose definition anchor its
// comment paragraph sits directly above. Paragraph bounds come from Guard B's
// own `paragraphBounds` (imported, never reimplemented) so the two guards
// cannot drift on what "its own comment paragraph" means. A marker anywhere
// else — inside a card's object literal, in a section header two paragraphs up,
// in a neighbouring card's doc block — attaches to nothing and exempts nothing.
// That is the same "no vouching across a seam" tightening issue #1900 applied
// to Guard B, adopted here from the start rather than after the leak.

import * as fs from "node:fs";
import { paragraphBounds, isParagraphBreak } from "./divergence-markers";

/**
 * A top-level `CardDefinition` export — the anchor a marker attaches to.
 *
 * Deliberately narrower than "any export": a `CardPrint`, a helper, a shared
 * ability template are not cards and have no Oracle text to round-trip.
 */
export const CARD_ANCHOR =
    /^export const\s+[A-Za-z0-9_$]+\s*:\s*CardDefinition\s*=/;

/** The card's own `name:` property, read out of the object literal below the
 *  anchor. This is the key Guard C joins the source scan to `getAllCards()`
 *  on — catalogue names are unique (asserted by Guard C's own test, "catalogue
 *  card names are unique"), and a
 *  name is what a human reads in a baseline diff, where an opaque print id is
 *  not. */
const NAME_PROPERTY = /^\s*name:\s*"((?:[^"\\]|\\.)*)"/;

/**
 * Any line claiming to be a compiler-gap marker, well-formed or not.
 *
 * Matches a `//` line AND a block-comment line (`/*`, or a ` * ` continuation).
 * Only `//` can ever ATTACH — `isParagraphBreak` ends a comment paragraph at
 * any non-`//` line, so a marker in a JSDoc block above an anchor owns nothing
 * — but recognising it is what turns that from INVISIBLE into a red saying
 * "attached to no card". An unrecognised marker is the one failure this format
 * is strict to avoid: the author believes the card is exempted and the guard
 * never mentions the marker at all.
 */
export const COMPILER_GAP_CLAIM = /(?:\/\/|\/\*|^\s*\*).*\bcompiler-gap:/i;

/**
 * The one accepted marker shape: `compiler-gap: <fragment> (#issue)`.
 *
 * The fragment is everything between the colon and the trailing parenthesised
 * issue ref, and must be non-empty — `compiler-gap: (#2698)` names no fragment
 * and so contributes nothing to the backlog the marker exists to feed.
 */
export const COMPILER_GAP = /\bcompiler-gap:\s*(\S.*?)\s*\(#(\d+)\)\s*$/i;

/** One `export const … : CardDefinition` site, with its doc paragraph. */
export interface CardAnchor {
    /** The card's `name:` — the join key with `getAllCards()`. */
    readonly name: string;
    /** 1-based line of the `export const` line itself. */
    readonly line: number;
    /** 0-based inclusive bounds of the comment paragraph directly above the
     *  anchor, or `undefined` when the anchor has no doc comment. */
    readonly doc?: { readonly start: number; readonly end: number };
}

/**
 * Every card-definition anchor in `lines`, in source order.
 *
 * The `name:` search runs from the anchor to the end of its object literal
 * (`^};` at column 0) rather than a fixed lookahead: `name:` is not always the
 * second property — `iko/multicolor.ts`'s Lutri carries a 13-line comment about
 * an import cycle between its anchor and its name — and a fixed window silently
 * drops such a card from the guard's reach, which is an exemption nobody wrote
 * down. An anchor whose name cannot be found at all is returned nowhere and
 * counted by the caller (`scanCardAnchors` reports it), never skipped quietly.
 */
export function scanCardAnchors(lines: string[]): {
    anchors: CardAnchor[];
    anchorsWithoutName: number[];
} {
    const anchors: CardAnchor[] = [];
    const anchorsWithoutName: number[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (!CARD_ANCHOR.test(lines[i])) continue;
        let name: string | undefined;
        for (let j = i + 1; j < lines.length; j++) {
            if (/^};/.test(lines[j]) || CARD_ANCHOR.test(lines[j])) break;
            const m = NAME_PROPERTY.exec(lines[j]);
            if (m) {
                name = m[1];
                break;
            }
        }
        if (name === undefined) {
            anchorsWithoutName.push(i + 1);
            continue;
        }
        anchors.push({ name, line: i + 1, doc: docParagraph(lines, i) });
    }
    return { anchors, anchorsWithoutName };
}

/** The comment paragraph directly above the anchor at 0-based line `i`, if the
 *  line immediately above it is a comment line that does not itself end a
 *  paragraph (a rule line, a blank `//`, or code). */
function docParagraph(
    lines: string[],
    i: number
): { start: number; end: number } | undefined {
    if (i === 0) return undefined;
    if (isParagraphBreak(lines[i - 1])) return undefined;
    return paragraphBounds(lines, i - 1);
}

/** One `compiler-gap:` claim found attached to a card. */
export interface CompilerGapMarker {
    /** The card the marker's paragraph vouches for. */
    readonly card: string;
    /** 1-based line of the marker. */
    readonly line: number;
    /** The trimmed marker line, for the offender message. */
    readonly text: string;
    /** The Oracle fragment the grammar cannot consume — `undefined` when the
     *  line does not match {@link COMPILER_GAP} (a malformed claim). */
    readonly fragment?: string;
    /** The tracking issue the marker names, `undefined` when malformed. */
    readonly issue?: number;
}

/**
 * Every `compiler-gap:` claim in `lines`, attached to the card whose doc
 * paragraph it sits in.
 *
 * A claim in a paragraph that is NOT a card's doc paragraph is returned with
 * `card: ""` so the caller can red it as unattached, rather than dropped: a
 * marker the author believed was exempting a card while it silently exempted
 * nothing is precisely the failure mode the strict format exists to prevent.
 */
export function scanCompilerGapMarkers(lines: string[]): CompilerGapMarker[] {
    const { anchors } = scanCardAnchors(lines);
    const owner = new Map<number, string>();
    for (const anchor of anchors) {
        if (!anchor.doc) continue;
        for (let i = anchor.doc.start; i <= anchor.doc.end; i++) {
            owner.set(i, anchor.name);
        }
    }
    const markers: CompilerGapMarker[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (!COMPILER_GAP_CLAIM.test(lines[i])) continue;
        const m = COMPILER_GAP.exec(lines[i]);
        markers.push({
            card: owner.get(i) ?? "",
            line: i + 1,
            text: lines[i].trim(),
            fragment: m?.[1],
            issue: m === null ? undefined : Number(m[2]),
        });
    }
    return markers;
}

/** `scanCompilerGapMarkers` / `scanCardAnchors` over a list of files on disk,
 *  with the file attached. Split from the pure scanners above so both stay
 *  unit-testable against a fixture with no I/O. */
export function scanFilesForCompilerGaps(
    files: readonly string[]
): Array<CompilerGapMarker & { file: string }> {
    const out: Array<CompilerGapMarker & { file: string }> = [];
    for (const file of files) {
        const lines = fs.readFileSync(file, "utf8").split("\n");
        for (const marker of scanCompilerGapMarkers(lines)) {
            out.push({ ...marker, file });
        }
    }
    return out;
}
