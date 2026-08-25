/**
 * Normalisation — the only step in the pipeline that is allowed to REMOVE text,
 * and therefore the one that has to justify every removal from the CR.
 *
 * Everything downstream is all-consuming (see `rule.ts`), so a normalisation
 * that quietly discarded rules text would be the one place the fail-closed
 * invariant could still leak. Each transformation below is either
 * meaning-preserving (typography) or removes text the CR states has no game
 * function; nothing else is dropped, and anything malformed fails closed.
 */

import type { OracleCard } from "./types";

/** Canonical stand-in for the card's own name — see `substituteSelf`. */
export const SELF_MARKER = "{self}";

export interface NormalizedText {
    /** Rules lines, in printed order, reminder text removed, each trimmed. */
    readonly lines: readonly string[];
}

export type NormalizeResult =
    | { readonly ok: true; readonly text: NormalizedText }
    | {
          readonly ok: false;
          readonly reason: string;
          readonly fragment: string;
      };

/** Typographic variants Scryfall emits that carry no rules meaning. */
const TYPOGRAPHY: readonly (readonly [RegExp, string])[] = [
    [/ /g, " "], // non-breaking space
    [/[‘’]/g, "'"], // curly single quotes
    [/[“”]/g, '"'], // curly double quotes
    [/−/g, "-"], // unicode minus
    [/\r\n?/g, "\n"], // CRLF
];

function applyTypography(text: string): string {
    let out = text;
    for (const [re, to] of TYPOGRAPHY) out = out.replace(re, to);
    return out;
}

/**
 * Remove reminder text.
 *
 * CR 207.2a — reminder text is italicised text in parentheses that summarises a
 * rule; it has no game function. Removing it is therefore not dropping rules
 * text, and NOT removing it would be worse than useless: it restates the rule
 * in prose the grammar would then have to parse twice.
 *
 * Unbalanced parentheses fail closed rather than being repaired — a card whose
 * text we cannot bracket correctly is a card we have not read.
 */
export function stripReminderText(text: string): NormalizeResult {
    let depth = 0;
    let out = "";
    for (const ch of text) {
        if (ch === "(") depth += 1;
        else if (ch === ")") {
            depth -= 1;
            if (depth < 0)
                return {
                    ok: false,
                    reason: "unbalanced ')' in oracle text",
                    fragment: text,
                };
        } else if (depth === 0) out += ch;
    }
    if (depth !== 0)
        return {
            ok: false,
            reason: "unbalanced '(' in oracle text",
            fragment: text,
        };
    return { ok: true, text: { lines: [out] } };
}

/**
 * Replace the card's own name with `SELF_MARKER`.
 *
 * CR 201.5 — an object's name in its own text refers to that object. Making the
 * self-reference an explicit marker means a later grammar rule binds a REFERENT
 * rather than a string, which is the anaphora class the competitor gets wrong
 * (PRD #2693). Matching is on whole-token boundaries so a name that is also a
 * common word cannot corrupt a neighbouring word.
 *
 * Known limitation, deliberate and fail-closed: the informal "short name" of a
 * legendary card ("Sidar Kondo" for "Sidar Kondo of Jamuraa") is NOT
 * substituted. The residue is a line containing a bare name, which no rule in
 * the grammar accepts — so such a card lands in `unparsed`, never in a wrong
 * reading.
 */
export function substituteSelf(text: string, name: string): string {
    if (name.length === 0) return text;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.replace(
        new RegExp(`(^|[^\\w'])${escaped}(?=$|[^\\w'])`, "g"),
        `$1${SELF_MARKER}`
    );
}

/**
 * Full normalisation for one card.
 *
 * Empty lines are dropped AFTER reminder-stripping. That is the one removal
 * with no text behind it: a line that was nothing but reminder text (every
 * basic land's `"({T}: Add {G}.)"`) normalises to the empty string, and an
 * empty string carries no rules to lose.
 */
export function normalizeOracleText(card: OracleCard): NormalizeResult {
    const typography = applyTypography(card.oracleText ?? "");
    const stripped = stripReminderText(typography);
    if (!stripped.ok) return stripped;
    const withSelf = substituteSelf(stripped.text.lines[0]!, card.name);
    const lines = withSelf
        .split("\n")
        .map((l) => l.replace(/\s+/g, " ").trim())
        .filter((l) => l.length > 0);
    return { ok: true, text: { lines } };
}
