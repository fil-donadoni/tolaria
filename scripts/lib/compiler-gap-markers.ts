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

/** End of an anchor's object literal at column 0 — `};` for a plain object
 *  literal, `});` for one passed to a factory (`defineSplitCard`). */
const OBJECT_END = /^\}\)?;/;

/** CR 709.4a — the separator between a split card's two names. Duplicated
 *  from `convex/cards/splitCard.ts` on purpose: this module is a SOURCE
 *  scanner run by the gate scripts and must not import engine code. Guard C's
 *  own join is what keeps the two in step — a drift here yields an anchor
 *  whose name matches no catalogue card, which reds. */
const SPLIT_NAME_SEPARATOR = " // ";

/**
 * Any line claiming to be a compiler-gap or hand-tail marker, well-formed or
 * not; group 1 names which.
 *
 * Matches a `//` line AND a block-comment line (`/*`, or a ` * ` continuation).
 * Only `//` can ever ATTACH — `isParagraphBreak` ends a comment paragraph at
 * any non-`//` line, so a marker in a JSDoc block above an anchor owns nothing
 * — but recognising it is what turns that from INVISIBLE into a red saying
 * "attached to no card". An unrecognised marker is the one failure this format
 * is strict to avoid: the author believes the card is exempted and the guard
 * never mentions the marker at all.
 */
export const COMPILER_GAP_CLAIM =
    /(?:\/\/|\/\*|^\s*\*).*?(?<![\w-])(compiler-gap|hand-tail):/i;

/**
 * The one accepted marker shape: `compiler-gap: <fragment> (#issue)`.
 *
 * The fragment is everything between the colon and the trailing parenthesised
 * issue ref, and must be non-empty — `compiler-gap: (#2698)` names no fragment
 * and so contributes nothing to the backlog the marker exists to feed.
 */
export const COMPILER_GAP = /\bcompiler-gap:\s*(\S.*?)\s*\(#(\d+)\)\s*$/i;

/**
 * The TERMINAL sibling of {@link COMPILER_GAP}: `hand-tail: <fragment> (#issue)`
 * (issue #3867, wayfinder issue #3848). Same shape, same attachment, same
 * stale check — a card that round-trips carries neither.
 *
 * Where `compiler-gap:` is temporary (the grammar owes the rule), `hand-tail:`
 * is a decision: the fragment's rule would unlock fewer corpus cards than
 * `handTailFloor` in `data/targets.json`, so the card is hand-written for good
 * and the issue is its closed hand-tail issue. A protocol (`resolve()`) card is
 * hand tail by construction and carries the same marker.
 */
export const HAND_TAIL = /\bhand-tail:\s*(\S.*?)\s*\(#(\d+)\)\s*$/i;

/** Which of the two Guard C markers a claim is. */
export type GapMarkerKind = "compiler-gap" | "hand-tail";

const MARKER_SHAPE: Readonly<Record<GapMarkerKind, RegExp>> = {
    "compiler-gap": COMPILER_GAP,
    "hand-tail": HAND_TAIL,
};

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
        // CR 709.4a (ADR 0121) — a SPLIT card's anchor carries no `name:` of
        // its own: `defineSplitCard` derives the combined name from the two
        // halves, and the first `name:` under the anchor is the LEFT half's
        // ("Stand", not "Stand // Deliver"). So the join key is rebuilt the
        // same way the derivation builds it, from the first two half names in
        // source order. Detected off the anchor line's own call rather than a
        // `splitHalves:` search, because the whole point of the helper is that
        // the field is written by it and never by the author.
        const isSplit = /=\s*defineSplitCard\(/.test(lines[i]);
        const names: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
            if (OBJECT_END.test(lines[j]) || CARD_ANCHOR.test(lines[j])) break;
            const m = NAME_PROPERTY.exec(lines[j]);
            if (m) {
                names.push(m[1]);
                if (names.length >= (isSplit ? 2 : 1)) break;
            }
        }
        const name =
            isSplit && names.length === 2
                ? names.join(SPLIT_NAME_SEPARATOR)
                : !isSplit && names.length === 1
                  ? names[0]
                  : undefined;
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

/** One `compiler-gap:` / `hand-tail:` claim found attached to a card. */
export interface CompilerGapMarker {
    readonly kind: GapMarkerKind;
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
 * Every `compiler-gap:` / `hand-tail:` claim in `lines`, attached to the card whose doc
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
        const claim = COMPILER_GAP_CLAIM.exec(lines[i]);
        if (claim === null) continue;
        const kind = claim[1]!.toLowerCase() as GapMarkerKind;
        const m = MARKER_SHAPE[kind].exec(lines[i]);
        markers.push({
            kind,
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

/** The part of a round-trip verdict the marker checks read. */
export interface MarkerVerdict {
    readonly ok: boolean;
    readonly kind: string;
}

/** A marker is well-formed AND attached — the only kind that exempts a card. */
export function isExempting(marker: CompilerGapMarker): boolean {
    return marker.fragment !== undefined && marker.card !== "";
}

/**
 * Markers that exempt nothing: malformed (no fragment or no issue ref on the
 * marker's own line) or attached to no card. Both kinds, one rule — a
 * `hand-tail:` typo must red exactly as loudly as a `compiler-gap:` one.
 */
export function unexemptingMarkers<M extends CompilerGapMarker>(
    markers: readonly M[]
): Array<M & { problem: "malformed" | "attached to no card" }> {
    return markers
        .filter((m) => !isExempting(m))
        .map((m) => ({
            ...m,
            problem:
                m.fragment === undefined
                    ? ("malformed" as const)
                    : ("attached to no card" as const),
        }));
}

/** Exempting markers on a card that round-trips now: the gap they name is gone. */
export function staleMarkers<M extends CompilerGapMarker>(
    markers: readonly M[],
    verdictOf: (card: string) => MarkerVerdict | undefined
): M[] {
    return markers.filter(
        (m) => isExempting(m) && verdictOf(m.card)?.ok === true
    );
}

/**
 * Exempting markers on a card the compiler READ and disagreed with (issue
 * #3050): a marker's deliverable is the fragment the grammar could not
 * consume, and a card that compiled has none — for a `hand-tail:` exactly as
 * for a `compiler-gap:`.
 */
export function misfiledMarkers<M extends CompilerGapMarker>(
    markers: readonly M[],
    verdictOf: (card: string) => MarkerVerdict | undefined
): M[] {
    return markers.filter((m) => {
        const verdict = verdictOf(m.card);
        return (
            isExempting(m) &&
            verdict !== undefined &&
            !verdict.ok &&
            verdict.kind !== "unparsed"
        );
    });
}
