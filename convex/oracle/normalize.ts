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
    // Escaped rather than literal: an irregular-whitespace character sitting
    // in source is invisible to a reviewer and to `no-irregular-whitespace`.
    [/\u00a0/g, " "], // non-breaking space
    [/[‘’]/g, "'"], // curly single quotes
    [/[“”]/g, '"'], // curly double quotes
    [/\u2212/g, "-"], // unicode minus
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
 * The full name only; the shortened name is `substituteShortName`'s, run
 * after this so the full name is always tried first.
 */
export function substituteSelf(text: string, name: string): string {
    if (name.length === 0) return text;
    return text.replace(wholeTokenRe(name), `$1${SELF_MARKER}`);
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `name` on whole-token boundaries; group 1 is the left boundary. */
function wholeTokenRe(name: string): RegExp {
    return new RegExp(`(^|[^\\w'])${escapeRe(name)}(?=$|[^\\w'])`, "gm");
}

/** Short names that are also a word the grammar reads in rules text: an
 *  occurrence cannot be told from the word, so the name is never shortened. */
const SHORT_NAME_WORDS: ReadonlySet<string> = new Set([
    "You",
    "It",
    "He",
    "She",
    "They",
]);

/**
 * The shortened name a card's own text may use for it (CR 201.5c), or `null`.
 *
 * Only the comma form is derived: a LEGENDARY card whose name contains `, `
 * is shortened to the part before the first comma ("Atraxa" for "Atraxa,
 * Grand Unifier"). A comma-named non-legendary card is a title, not a name
 * with an epithet ("Elemental, My Dear" is not "Elemental"), and a name with
 * no comma ("Sidar Kondo of Jamuraa") has no shortening the text proves —
 * both stay unshortened, so a bare short name in them fails closed.
 */
export function shortNameOf(name: string, typeLine: string): string | null {
    if (!/\bLegendary\b/.test(typeLine) || name.includes(" // ")) return null;
    const comma = name.indexOf(", ");
    if (comma <= 0) return null;
    const short = name.slice(0, comma);
    return SHORT_NAME_WORDS.has(short) ? null : short;
}

/**
 * An occurrence of the short name that is NOT the card itself, judged from
 * its neighbours. Each shape is one the corpus prints:
 *
 * - a determiner or `non-` before it makes it a subtype ("a Lukka
 *   planeswalker", "each Garruk you control", "non-Gideon creatures"), and
 *   `named` / `called` makes it a name searched for, not this object;
 * - a type noun after it, likewise ("a green Lizard creature");
 * - a capitalised word after it — directly, after `, `, or after `of` /
 *   `the` / `and` — makes it part of ANOTHER name ("create Stangg Twin",
 *   "meld them into Mishra, Lost to Phyrexia");
 * - an em dash after it makes it a flavour-word heading, not a reference
 *   ("• Typhoid Mary — Draw a card.");
 * - alone on its line, or opening one before a comma, it reads as a keyword.
 */
function isForeignOccurrence(before: string, after: string): boolean {
    return (
        /(?:^|\s)(?:a|an|another|each|target|other|all|any|no|non-|that|this|the|different|chosen|your|than|named|called)\s*$/i.test(
            before
        ) ||
        /-$/.test(before) ||
        /^-/.test(after) ||
        /^ (?:creature|planeswalker|card|permanent|spell|token)s?\b/.test(
            after
        ) ||
        /^ (?:(?:of|the|and) ){0,2}[A-Z]/.test(after) ||
        /^, (?:the\b|[A-Z])/.test(after) ||
        /^ —/.test(after) ||
        (/(?:^|\n)$/.test(before) && /^(?:$|\n|,)/.test(after))
    );
}

/**
 * Replace the card's shortened name with `SELF_MARKER` (CR 201.5c —
 * "instances of a card's shortened name used in this manner are treated as
 * though they used the card's full name").
 *
 * All or nothing per card: if ANY occurrence of the short name is foreign
 * (`isForeignOccurrence`), none is substituted. A card that names a subtype
 * or another legend sharing its prefix keeps every bare short name, which no
 * grammar rule accepts — so it lands in `unparsed`, never in a reading that
 * took another object for itself.
 */
export function substituteShortName(
    text: string,
    name: string,
    typeLine: string
): string {
    const short = shortNameOf(name, typeLine);
    if (short === null) return text;
    const re = wholeTokenRe(short);
    for (const m of text.matchAll(re)) {
        const start = m.index + m[1]!.length;
        const before = text.slice(0, start);
        const after = text.slice(start + short.length);
        if (isForeignOccurrence(before, after)) return text;
    }
    return text.replace(re, `$1${SELF_MARKER}`);
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
    const withSelf = substituteShortName(
        substituteSelf(stripped.text.lines[0]!, card.name),
        card.name,
        card.typeLine
    );
    const lines = withSelf
        .split("\n")
        .map((l) => l.replace(/\s+/g, " ").trim())
        .filter((l) => l.length > 0);
    return { ok: true, text: { lines } };
}
