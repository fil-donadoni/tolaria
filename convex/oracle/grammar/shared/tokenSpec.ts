/**
 * Shared sub-grammar: TOKEN CREATION — "Create two 1/1 red and white Goblin
 * Soldier creature tokens" (CR 111.1, CR 111.3).
 *
 * One sentence, read whole. The token's characteristics are exactly what the
 * sentence defines (CR 111.3 — "A token doesn't have any characteristics not
 * defined by the spell or ability that created it"), so the rule reads each
 * one it will write and refuses every word it cannot place: a colour it does
 * not know, a subtype outside the creature-type list, a second keyword. None
 * of those is skipped — each is a
 * characteristic the token would silently lack.
 *
 * ── Accepted forms ─────────────────────────────────────────────────────────
 *
 *  - `Create <count> P/T <colour> <Subtype…> creature token[s][ with <keyword>]`
 *    — a printed cardinal ("a", "two"), one colour or two joined by "and"
 *    (CR 105.1), one or more creature subtypes (CR 205.3m), at most one
 *    keyword (CR 702.1).
 *  - `Create <count> P/T colorless <Subtype…> artifact creature token[s][ with
 *    <keyword>]` — CR 105.2c: "colorless" is the ABSENCE of colour, an empty
 *    colour list (`colors: []`), not a missing one and not a sixth colour.
 *    "artifact creature" is the token's type list (CR 205.2a, CR 111.3 — a
 *    token has the card types its creator prints and no others): the rule
 *    reads the two together, because a colorless non-artifact creature token
 *    is a form no fixture pins yet.
 *  - `Create <count> P/T <colour>[ and <colour>] <Subtype…> artifact creature
 *    token[s]` — the coloured artifact token (CR 205.2a): the colours of the
 *    first form, the type list of the second.
 *  - `Create X P/T … creature tokens, where X is that <type>'s mana value`
 *    — X is CR 202.3's mana value of the object the sentence before it acted
 *    on. The referent lives in that sentence, so the rule records only the
 *    noun; lowering binds it (`lowerEffects.ts`) and refuses a noun that
 *    names no object acted on before it.
 *
 *  - `The exiled card's owner creates an X/X <colour> <Subtype…> creature
 *    token, where X is the mana value of the exiled card` — CR 607.2a +
 *    CR 608.2h: both the creator and X are read off the card this object's
 *    LINKED exile instruction exiled, as it last existed. A whole-sentence
 *    form of its own ({@link linkedExileTokenRule}): the creator is not the
 *    controller (CR 111.2), and the size is not a printed number.
 *
 *  - `Create <count> [tapped] <Name> token[s]` — a PREDEFINED token
 *    (CR 111.10): the name is the whole definition, so the rule reads only
 *    the name, the count and "tapped", and looks the token up in
 *    the engine's one name→spec table (`PREDEFINED_TOKEN_SPECS`). "Tapped"
 *    is the creating effect modifying the token as it is created (CR 111.10:
 *    "The effect that creates a predefined token may also modify or add to
 *    the predefined characteristics"). A name the table does not define
 *    (Gold, Junk, a Role) is refused, never read as a creature subtype. The
 *    count is a printed cardinal or the announced X (CR 107.3); "that many",
 *    "half X" and every other count are refused.
 *
 * Singular and plural must agree with the count ("a … token", "two …
 * tokens"): a disagreement is a line we have misread, not a typo to forgive.
 */

import {
    predefinedTokenName,
    type PredefinedTokenName,
} from "../../../cards/sharedTokens";
import type { Color } from "../../../cards/types";
import type { KeywordIR } from "../ir";
import { fail, ok, rule, type Rule, type RuleResult } from "../../rule";
import { keywordVocabulary } from "./keywordVocabulary";
import { readNumberWord } from "./quantity";
import { CREATURE_SUBTYPES } from "./subtypes";
import { COLOR_WORDS } from "./targetFilter";

/** The characteristics a created token is given (CR 111.3). */
export interface TokenIR {
    readonly power: number;
    readonly toughness: number;
    /**
     * CR 105.1 — as printed, in printed order. Empty exactly when the token
     * is printed "colorless" (CR 105.2c), and then `artifact` is true.
     */
    readonly colors: readonly Color[];
    /** CR 205.2a — "artifact creature token": the token is an Artifact too. */
    readonly artifact: boolean;
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
    | { readonly kind: "mana-value-of-that"; readonly noun: string }
    /**
     * CR 107.3 — "Create X … tokens" with nothing after it: the X the spell
     * announced (Decree of Justice). The lowering gates it on the site
     * announcing an {X}, exactly as every other effect magnitude is.
     */
    | { readonly kind: "announced-x" }
    /**
     * CR 700.4 + CR 111.7 — "Create a … token for each nontoken creature put
     * into your graveyard from the battlefield this turn": one token per
     * nontoken creature that died into the controller's graveyard this turn.
     */
    | { readonly kind: "nontoken-creatures-to-your-graveyard-this-turn" };

/** A creature token the sentence defines characteristic by characteristic. */
export interface CreateDefinedTokenIR {
    readonly count: TokenCountIR;
    readonly token: TokenIR;
}

/**
 * CR 111.10 — a predefined token, named: its characteristics are the
 * definition's, never the line's, so the IR carries only the name.
 */
export interface CreatePredefinedTokenIR {
    readonly predefined: PredefinedTokenName;
    /**
     * The printed cardinal ("a" = 1), or CR 107.3's X the
     * ability announced (Treasure Vault's "{X}{X}, {T}, Sacrifice this
     * land: Create X Treasure tokens"), gated by the lowering on a site
     * that announces one.
     */
    readonly count: Extract<
        TokenCountIR,
        { kind: "fixed" } | { kind: "announced-x" }
    >;
    /** CR 111.10 — "tapped": the creating effect's own modification. */
    readonly tapped: boolean;
}

export type CreateTokenIR = CreateDefinedTokenIR | CreatePredefinedTokenIR;

/** What the descriptor words between P/T and "creature" define. */
interface DescribedToken {
    colors: Color[];
    artifact: boolean;
    subtypes: string[];
}

/** The fixed-count form. `with` is the optional keyword tail. */
const CREATE_FIXED =
    /^Create (\S+) (\d+)\/(\d+) (.+) creature (tokens?)(?: with (.+))?$/;
/** The X form: X read back off the object the previous sentence acted on. */
const CREATE_X_THAT =
    /^Create X (\d+)\/(\d+) (.+) creature tokens, where X is that (\w+)'s mana value$/;

/** The announced-X form: plural by construction, X is the spell's own {X}. */
const CREATE_X_ANNOUNCED =
    /^Create X (\d+)\/(\d+) (.+) creature tokens(?: with (.+))?$/;

/** The per-death form: singular by construction ("a … token for each …"). */
const CREATE_FOR_EACH_NONTOKEN_DEATH =
    /^Create a (\d+)\/(\d+) (.+) creature token for each nontoken creature put into your graveyard from the battlefield this turn$/;

/**
 * The predefined form: a capitalised name directly before "token[s]", so a
 * creature token's "1/1" or a colour word never reaches it.
 */
const CREATE_PREDEFINED = /^Create (\S+) (tapped )?([A-Z][a-z]+) (tokens?)$/;

const KEYWORDS = keywordVocabulary();

/**
 * "<colour>[ and <colour>] <Subtype>…[ artifact]" or "colorless <Subtype>…
 * artifact" —
 * the words between P/T and "creature". Returns the reason as a string when a
 * word has no place.
 */
function readDescriptor(words: string): DescribedToken | string {
    const parts = words.split(" ");
    if (parts[0] === "colorless") return readColorlessArtifact(parts);
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
    // CR 205.2a + CR 111.3 — "<colour> <Subtype>… artifact creature token":
    // a coloured token that is an artifact too (General Ferrous Rokiric's
    // "4/4 red and white Golem artifact creature token"). The type word sits
    // after the subtypes, exactly where the colorless form prints it.
    const artifact = parts[parts.length - 1] === "artifact";
    const subtypes = readSubtypes(
        artifact ? parts.slice(at, -1) : parts.slice(at)
    );
    if (typeof subtypes === "string") return subtypes;
    return { colors, artifact, subtypes };
}

/** CR 105.2c + CR 205.2a — "colorless <Subtype>… artifact". */
function readColorlessArtifact(
    parts: readonly string[]
): DescribedToken | string {
    if (parts[parts.length - 1] !== "artifact")
        return '"colorless" is read only on an artifact creature token';
    const subtypes = readSubtypes(parts.slice(1, -1));
    if (typeof subtypes === "string") return subtypes;
    return { colors: [], artifact: true, subtypes };
}

/** CR 205.3m — every word a creature type, and at least one. */
function readSubtypes(subtypes: readonly string[]): string[] | string {
    if (subtypes.length === 0) return "a creature token needs a subtype";
    for (const subtype of subtypes)
        if (!CREATURE_SUBTYPES.has(subtype))
            return `"${subtype}" is not a creature type`;
    return [...subtypes];
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
        artifact: described.artifact,
        subtypes: described.subtypes,
        keyword,
    };
}

/** CR 111.1 — "Create <count> P/T <colours> <Subtypes> [artifact] creature token(s)…". */
export const createTokenRule: Rule<CreateTokenIR> = rule<CreateTokenIR>(
    "create token",
    (span) => {
        const predefined = span.match(CREATE_PREDEFINED);
        if (predefined !== null) return readPredefined(span, predefined);
        const x = span.match(CREATE_X_THAT);
        if (x !== null) {
            const token = readToken(x[1]!, x[2]!, x[3]!, undefined);
            if (typeof token === "string") return fail(token, span);
            // No corpus card prints an X-count artifact token in this shape,
            // so no fixture pins it: refused, not read by leakage.
            if (token.artifact)
                return fail('"artifact" is not read on an X-count token', span);
            return ok({
                count: { kind: "mana-value-of-that" as const, noun: x[4]! },
                token,
            });
        }
        const announced = span.match(CREATE_X_ANNOUNCED);
        if (announced !== null) {
            const token = readToken(
                announced[1]!,
                announced[2]!,
                announced[3]!,
                announced[4]
            );
            if (typeof token === "string") return fail(token, span);
            // As the where-X form: no corpus card prints an X-count
            // artifact token, so none is read.
            if (token.artifact)
                return fail('"artifact" is not read on an X-count token', span);
            return ok({ count: { kind: "announced-x" as const }, token });
        }
        const perDeath = span.match(CREATE_FOR_EACH_NONTOKEN_DEATH);
        if (perDeath !== null) {
            const token = readToken(
                perDeath[1]!,
                perDeath[2]!,
                perDeath[3]!,
                undefined
            );
            if (typeof token === "string") return fail(token, span);
            // No corpus card prints an artifact token in this shape, so none
            // is read.
            if (token.artifact)
                return fail(
                    '"artifact" is not read on a per-death token count',
                    span
                );
            return ok({
                count: {
                    kind: "nontoken-creatures-to-your-graveyard-this-turn" as const,
                },
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

/**
 * CR 111.10 — "Create <count> [tapped] <Name> token[s]": the name must be one
 * the engine defines, the count a printed cardinal agreeing with "token[s]".
 */
function readPredefined(
    span: string,
    match: RegExpMatchArray
): RuleResult<CreateTokenIR> {
    const name = predefinedTokenName(match[3]!);
    if (name === null)
        return fail(
            `"${match[3]}" is not a predefined token the engine defines`,
            span
        );
    const tapped = match[2] !== undefined;
    // CR 107.3 — "Create X <Name> tokens": plural by construction.
    if (match[1] === "X") {
        if (match[4] !== "tokens")
            return fail('"X" does not agree with "token"', span);
        return ok({
            predefined: name,
            count: { kind: "announced-x" as const },
            tapped,
        });
    }
    const count = readNumberWord(match[1]!);
    if (count === null || count < 1)
        return fail(`"${match[1]}" is not a count`, span);
    if ((count === 1) !== (match[4] === "token"))
        return fail(`"${match[1]}" does not agree with "${match[4]}"`, span);
    return ok({
        predefined: name,
        count: { kind: "fixed" as const, value: count },
        tapped,
    });
}

/**
 * CR 607.2a + CR 608.2h + CR 111.2 — "The exiled card's owner creates an X/X
 * <colour> <Subtype…> creature token, where X is the mana value of the exiled
 * card": a single token whose creator and size both come from the card the
 * linked exile instruction exiled. The token reads only colours and subtypes;
 * an artifact token, a keyword, a count, or any other source of X is a
 * neighbour no corpus card prints, refused.
 */
const LINKED_EXILE_TOKEN =
    /^The exiled card(?:'|’)s owner creates an X\/X (.+) creature token, where X is the mana value of the exiled card$/;

/** The characteristics of the linked exile's token, X/X aside. */
export interface LinkedExileTokenIR {
    readonly colors: readonly Color[];
    readonly subtypes: readonly string[];
}

export const linkedExileTokenRule: Rule<LinkedExileTokenIR> =
    rule<LinkedExileTokenIR>("linked exile token", (span) => {
        const match = span.match(LINKED_EXILE_TOKEN);
        if (match === null)
            return fail("not the linked exile's owner creating a token", span);
        const described = readDescriptor(match[1]!);
        if (typeof described === "string") return fail(described, span);
        if (described.artifact)
            return fail(
                '"artifact" is not read on the linked exile\'s token',
                span
            );
        return ok({
            colors: described.colors,
            subtypes: described.subtypes,
        });
    });

/**
 * CR 701.16a — "Investigate" means "Create a Clue token": the keyword action
 * is the predefined-token form with the name fixed to Clue (CR 111.10f), so
 * it reads into the very {@link CreatePredefinedTokenIR} "Create a Clue
 * token" does and lowers through the one name→spec table — never a second
 * copy of the Clue spec.
 *
 * Accepted: "Investigate" (one Clue), "Investigate twice", "Investigate
 * <cardinal> times" (three or more — two is printed "twice"), and
 * "Investigate X times" with nothing after it (CR 107.3's announced X, gated
 * by the lowering on a site that announces one). Every other count — "for
 * each …", "that many times", "X times, where X is …" — is refused.
 */
const INVESTIGATE = /^Investigate(?: (twice|(\S+) times))?$/;

export const investigateRule: Rule<CreatePredefinedTokenIR> =
    rule<CreatePredefinedTokenIR>("investigate", (span) => {
        const match = span.match(INVESTIGATE);
        if (match === null) return fail("not an investigate", span);
        const clue = predefinedTokenName("Clue");
        if (clue === null)
            return fail(
                '"Clue" is not a predefined token the engine defines',
                span
            );
        if (match[1] === undefined)
            return ok({
                predefined: clue,
                count: { kind: "fixed" as const, value: 1 },
                tapped: false,
            });
        if (match[1] === "twice")
            return ok({
                predefined: clue,
                count: { kind: "fixed" as const, value: 2 },
                tapped: false,
            });
        if (match[2] === "X")
            return ok({
                predefined: clue,
                count: { kind: "announced-x" as const },
                tapped: false,
            });
        const count = readNumberWord(match[2]!);
        if (count === null || count < 3)
            return fail(
                `"${match[2]} times" is not an investigate count`,
                span
            );
        return ok({
            predefined: clue,
            count: { kind: "fixed" as const, value: count },
            tapped: false,
        });
    });
