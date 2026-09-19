/**
 * Shared sub-grammar: TOKEN CREATION — "Create two 1/1 red and white Goblin
 * Soldier creature tokens" (CR 111.1, CR 111.3).
 *
 * One sentence, read whole. The token's characteristics are exactly what the
 * sentence defines (CR 111.3 — "A token doesn't have any characteristics not
 * defined by the spell or ability that created it"), so the rule reads each
 * one it will write and refuses every word it cannot place: a colour it does
 * not know, a subtype outside the creature-type list, a second keyword, a
 * token that is also an artifact. None of those is skipped — each is a
 * characteristic the token would silently lack.
 *
 * ── Accepted forms ─────────────────────────────────────────────────────────
 *
 *  - `Create <count> P/T <colour> <Subtype…> creature token[s][ with <keyword>]`
 *    — a printed cardinal ("a", "two"), one colour or two joined by "and"
 *    (CR 105.1), one or more creature subtypes (CR 205.3m), at most one
 *    keyword (CR 702.1).
 *  - `Create X P/T … creature tokens, where X is that <type>'s mana value`
 *    — X is CR 202.3's mana value of the object the sentence before it acted
 *    on. The referent lives in that sentence, so the rule records only the
 *    noun; lowering binds it (`lowerEffects.ts`) and refuses a noun that
 *    names no object acted on before it.
 *
 * Singular and plural must agree with the count ("a … token", "two …
 * tokens"): a disagreement is a line we have misread, not a typo to forgive.
 */

import type { Color } from "../../../cards/types";
import type { KeywordIR } from "../ir";
import { fail, ok, rule, type Rule } from "../../rule";
import { keywordVocabulary } from "./keywordVocabulary";
import { readNumberWord } from "./quantity";
import { CREATURE_SUBTYPES } from "./subtypes";
import { COLOR_WORDS } from "./targetFilter";

/** The characteristics a created token is given (CR 111.3). */
export interface TokenIR {
    readonly power: number;
    readonly toughness: number;
    /** CR 105.1 — as printed, in printed order. Never empty. */
    readonly colors: readonly Color[];
    /** CR 205.3m — creature subtypes, in printed order. Never empty. */
    readonly subtypes: readonly string[];
    readonly keyword: KeywordIR | null;
}

/** How many tokens (CR 107.1). */
export type TokenCountIR =
    | { readonly kind: "fixed"; readonly value: number }
    /**
     * CR 202.3 / CR 608.2h — "where X is that <noun>'s mana value": the mana
     * value of the object the previous sentence acted on, read as it last
     * existed. `noun` is the printed type word ("creature", "artifact").
     */
    | { readonly kind: "mana-value-of-that"; readonly noun: string };

export interface CreateTokenIR {
    readonly count: TokenCountIR;
    readonly token: TokenIR;
}

/** The fixed-count form. `with` is the optional keyword tail. */
const CREATE_FIXED =
    /^Create (\S+) (\d+)\/(\d+) (.+) creature (tokens?)(?: with (.+))?$/;
/** The X form: X read back off the object the previous sentence acted on. */
const CREATE_X_THAT =
    /^Create X (\d+)\/(\d+) (.+) creature tokens, where X is that (\w+)'s mana value$/;

const KEYWORDS = keywordVocabulary();

/**
 * "<colour>[ and <colour>] <Subtype>…" — the words between P/T and
 * "creature". Returns the reason as a string when a word has no place.
 */
function readDescriptor(
    words: string
): { colors: Color[]; subtypes: string[] } | string {
    const parts = words.split(" ");
    const first = COLOR_WORDS.get(parts[0]!);
    if (first === undefined) return `"${parts[0]}" is not a colour`;
    const colors: Color[] = [first];
    let at = 1;
    if (parts[1] === "and") {
        const second = COLOR_WORDS.get(parts[2] ?? "");
        if (second === undefined) return `"${parts[2]}" is not a colour`;
        colors.push(second);
        at = 3;
    }
    const subtypes = parts.slice(at);
    if (subtypes.length === 0) return "a creature token needs a subtype";
    for (const subtype of subtypes)
        if (!CREATURE_SUBTYPES.has(subtype))
            return `"${subtype}" is not a creature type`;
    return { colors, subtypes };
}

function readToken(
    power: string,
    toughness: string,
    descriptor: string,
    keywordPhrase: string | undefined
): TokenIR | string {
    const described = readDescriptor(descriptor);
    if (typeof described === "string") return described;
    let keyword: KeywordIR | null = null;
    if (keywordPhrase !== undefined) {
        const found = KEYWORDS.get(keywordPhrase.toLowerCase());
        if (found === undefined)
            return `"${keywordPhrase}" is not a Mechanics Registry keyword`;
        keyword = found;
    }
    return {
        power: Number(power),
        toughness: Number(toughness),
        colors: described.colors,
        subtypes: described.subtypes,
        keyword,
    };
}

/** CR 111.1 — "Create <count> P/T <colours> <Subtypes> creature token(s)…". */
export const createTokenRule: Rule<CreateTokenIR> = rule<CreateTokenIR>(
    "create token",
    (span) => {
        const x = span.match(CREATE_X_THAT);
        if (x !== null) {
            const token = readToken(x[1]!, x[2]!, x[3]!, undefined);
            if (typeof token === "string") return fail(token, span);
            return ok({
                count: { kind: "mana-value-of-that" as const, noun: x[4]! },
                token,
            });
        }
        const fixed = span.match(CREATE_FIXED);
        if (fixed === null) return fail("not a token creation", span);
        const count = readNumberWord(fixed[1]!);
        if (count === null || count < 1)
            return fail(`"${fixed[1]}" is not a count`, span);
        if ((count === 1) !== (fixed[5] === "token"))
            return fail(
                `"${fixed[1]}" does not agree with "${fixed[5]}"`,
                span
            );
        const token = readToken(fixed[2]!, fixed[3]!, fixed[4]!, fixed[6]);
        if (typeof token === "string") return fail(token, span);
        return ok({ count: { kind: "fixed" as const, value: count }, token });
    }
);
