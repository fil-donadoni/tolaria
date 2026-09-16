/**
 * Logical lines for the CR citation scans (issue #2514).
 *
 * Every scan under `bun run cr:lint` is line-anchored, and prose in comments
 * wraps. When it wraps mid-citation the scans go blind in two ways: the `CR `
 * prefix ends one line and the id starts the next (the id carries no prefix of
 * its own, and its line does not mention `CR `, so neither pass of the
 * existence scan sees it — ~379 sites when this was measured), or the id ends
 * a line and the keyword it names starts the next (the id resolves, but the
 * keyword-title scan compares it against a line that names nothing — ~394
 * sites, ~76 of them 701/702 citations, and 16 of those cited a different
 * keyword than the one they named).
 *
 * This module is the ONE place both shapes are joined, so every scan sees a
 * wrapped citation exactly as a reader does. The join is deliberately narrow:
 * a line is joined with the next ONLY when its last token is the dangling half
 * of a citation — a bare `CR`, or a rule id — AND the next line continues the
 * same comment (same comment marker, not blank, not the block's closer). For
 * the bare-`CR` shape the next line must also START with a rule id. Outside
 * that condition the window stays exactly one physical line, so the objection
 * that kept the scans single-line (ordinary prose numbers on the line after
 * any `CR ` mention would start resolving) never applies: the join cannot fire
 * unless the previous line literally ends mid-citation.
 *
 * Positions are kept: `lineAt` maps a character of the joined text back to the
 * physical line it came from, so a hit is reported where the id is, and the
 * citation ledger (`cr-ledger.ts`) keeps keying on the PHYSICAL line the id
 * sits on — a wrapped citation that was already visible keeps its entry, and
 * one that was not enters through a tokenizer widening (issue #3697).
 *
 * What remains out of reach, on purpose: a bare id on a line that mentions
 * `CR ` nowhere and does not continue a citation-ending line (~1,795 today,
 * most of them in the mechanics registry, and most not citations at all).
 *
 * This file is part of the tokenizer (`TOKENIZER_PATHS` in
 * `check-cr-citations.ts`): a change here is a change to what counts as a
 * citation, and the ledger's widening check is measured against it.
 */

export type LogicalPart = {
    /** 1-based physical line number. */
    line: number;
    /** Offset in the joined text where this part's content starts. */
    offset: number;
    /** The physical line, verbatim — what the ledger keys on. */
    raw: string;
};

export type LogicalLine = {
    /** What the scans read: the physical lines joined by one space, each
     *  continuation's comment marker removed. */
    text: string;
    /** The physical lines that make it up, in order — at least one. */
    parts: LogicalPart[];
};

/** A line whose last token is a bare `CR`: the prefix, its id on the next line. */
const ENDS_WITH_PREFIX = /\bCR$/;
/**
 * A line whose last token is a prefixed citation, allowing the bracket and the
 * clause break that commonly follow an id mid-sentence ("(… 701.23a),"). A
 * sentence-ending period is NOT allowed: the claim is over, and the next
 * sentence is a different claim.
 */
const ENDS_WITH_PREFIXED_ID =
    /\bCR\s?\d{3}(?:\.\d+[a-z]{0,2})?[)\]]?(?:\s*[,;:\/])?$/;
/** A bare id ending the line — a citation only if the line mentions `CR `. */
const ENDS_WITH_BARE_ID = /\b\d{3}\.\d+[a-z]{0,2}[)\]]?(?:\s*[,;:\/])?$/;
/** What a continuation must start with after a bare `CR`. */
const STARTS_WITH_ID = /^\d{3}(?:\.\d+[a-z]{0,2})?\b/;
/** The comment marker a continuation line carries, stripped before joining. */
const CONTINUATION_MARKER = /^\s*(?:\*(?!\/)|\/\/+|>)?\s*/;

type Marker = "block" | "line" | "quote" | "none";

/** The comment the line ENDS in — what a continuation has to match. */
function endingMarker(line: string): Marker {
    if (/^\s*(?:\/\*|\*(?!\/))/.test(line)) return "block";
    if (line.includes("//")) return "line";
    if (/^\s*>/.test(line)) return "quote";
    return "none";
}

/** The comment the line STARTS with. A block-comment closer is none. */
function startingMarker(line: string): Marker {
    if (/^\s*\*(?!\/)/.test(line)) return "block";
    if (/^\s*\/\//.test(line)) return "line";
    if (/^\s*>/.test(line)) return "quote";
    return "none";
}

/** Whether `next` continues a citation that `line` leaves dangling. */
export function continuesCitation(line: string, next: string): boolean {
    const left = line.trimEnd();
    if (endingMarker(left) !== startingMarker(next)) return false;
    const content = next.replace(CONTINUATION_MARKER, "").trimEnd();
    if (!content.length) return false;
    if (ENDS_WITH_PREFIX.test(left)) return STARTS_WITH_ID.test(content);
    if (ENDS_WITH_PREFIXED_ID.test(left)) return true;
    return left.includes("CR ") && ENDS_WITH_BARE_ID.test(left);
}

/**
 * Splits `text` into logical lines: every physical line on its own, except
 * that a line ending mid-citation is joined with the continuation(s) that
 * complete it.
 */
export function citationLines(text: string): LogicalLine[] {
    const lines = text.split("\n");
    const out: LogicalLine[] = [];
    let i = 0;
    while (i < lines.length) {
        const parts: LogicalPart[] = [
            { line: i + 1, offset: 0, raw: lines[i] },
        ];
        let joined = lines[i].trimEnd();
        let last = i;
        while (
            last + 1 < lines.length &&
            continuesCitation(lines[last], lines[last + 1])
        ) {
            last++;
            const content = lines[last]
                .replace(CONTINUATION_MARKER, "")
                .trimEnd();
            parts.push({
                line: last + 1,
                offset: joined.length + 1,
                raw: lines[last],
            });
            joined = `${joined} ${content}`;
        }
        out.push({ text: joined, parts });
        i = last + 1;
    }
    return out;
}

/** The physical line the character at `offset` of a logical line came from. */
export function lineAt(logical: LogicalLine, offset: number): LogicalPart {
    let at = logical.parts[0];
    for (const part of logical.parts) {
        if (part.offset <= offset) at = part;
        else break;
    }
    return at;
}
