/**
 * Shared sub-grammar: "FROM AMONG THEM" — a pick scoped to the cards the
 * sentence before put in view (issue #5499).
 *
 * "them" is a back-reference, never a zone: CR 608.2c reads it against the
 * earlier text of the same ability, so the set is whatever the ANTECEDENT
 * sentence named — the top N cards it looked
 * at or revealed, or the N cards it milled. This module reads the words and
 * the card the pick may take; it does NOT decide the set. The rule that folds
 * the pick onto its antecedent does, and lowers it to the engine scoping that
 * antecedent owns (`lookDistribute`'s window, or `mill.bindAll` feeding a
 * public-zone `choice.candidates`, issue #2600) — a pick with no antecedent in
 * front of it is a sentence with nothing to point at, and fails.
 *
 * Fail-closed (ADR 0105 § 2): the card phrase is read by the shared
 * descriptor grammar, then narrowed to the clauses a golden fixture pins. Any
 * other clause ("with power 2 or less", "historic") is refused rather than
 * dropped — a dropped clause widens the set of cards the player may take. So
 * is every neighbour the corpus prints without a readable card behind it: the
 * mandatory pick ("Reveal a … card from among them"), "put THAT CARD", and the
 * other back-references ("the revealed cards", "those cards").
 */

import {
    fail,
    ok,
    rule,
    type Rule,
    type RuleResult,
    subGrammar,
} from "../../rule";
import { PERMANENT_TYPES, type EffectCardFilter } from "../../../cards/types";
import { descriptorRule, type DescriptorIR } from "./targetFilter";

export const FROM_AMONG = "from among";

/** A pick of ONE card out of the antecedent's set, as the phrase prints it. */
export interface AmongPickIR {
    /** The card the pick may take — what the phrase's descriptor names. */
    readonly filter: EffectCardFilter;
    /** The phrase as printed ("a land card"), for the choice prompt. */
    readonly card: string;
}

/**
 * The pick SENTENCE. Always a "You may": the controller may take nothing,
 * which is also what a filter matching no card in the set leaves them.
 */
export interface AmongPickSentenceIR {
    readonly pick: AmongPickIR;
    /** CR 701.20a — "reveal it and put it …": the TAKEN card is shown. */
    readonly reveal: boolean;
}

/** The printed back-reference: the antecedent's set. */
const BACK_REFERENCE = "from among them";
const AMONG_PICK = new RegExp(`^(an? .+ card) ${BACK_REFERENCE}$`);
/** "You may reveal <pick> and put it into your hand". */
const PICK_REVEAL = new RegExp(
    `^You may reveal (an? .+ card ${BACK_REFERENCE}) and put it into your hand$`
);
/** "You may put <pick> into your hand". */
const PICK_PUT = new RegExp(
    `^You may put (an? .+ card ${BACK_REFERENCE}) into your hand$`
);

/** The descriptor clauses a pick reads, each pinned by a golden fixture. */
const PICK_FIELDS: ReadonlySet<string> = new Set([
    "card",
    "types",
    "excludeTypes",
    "subtypes",
    "colors",
]);

/**
 * "a <descriptor> card from among them" → the card the pick may take.
 *
 * Only the singular "a/an … card" is read: a plural ("any number of … cards",
 * "up to two … cards") is a different pick count, and its own form.
 */
export const amongPickRule: Rule<AmongPickIR> = subGrammar(
    FROM_AMONG,
    rule<AmongPickIR>(FROM_AMONG, (span, ctx) => {
        const match = span.match(AMONG_PICK);
        if (match === null) return fail('not "a <card> from among them"', span);
        const card = match[1]!;
        // CR 110.4a — "permanent card" is a defined term, not a type: any of
        // the card types that could be put onto the battlefield.
        if (card === "a permanent card")
            return ok({ filter: { type: [...PERMANENT_TYPES] }, card });
        const descriptor = descriptorRule.run(card.replace(/^an? /, ""), ctx);
        if (!descriptor.ok) return descriptor;
        const filter = pickFilter(descriptor.value);
        if (typeof filter === "string") return fail(filter, card);
        return ok({ filter, card });
    })
);

/**
 * CR 205.2a + CR 608.2c — "For each card type, you may put a card of that type
 * from among the revealed cards into your hand": one pick PER card type out of
 * the revealed window, a card claimable by one type only. The words are fixed;
 * a narrower category list ("for each color") is a different form.
 */
const TYPE_PICK =
    /^For each card type, you may put a card of that type from among the revealed cards into your hand$/;

/** True when the sentence is the per-card-type pick. */
export function printsTypePick(span: string): boolean {
    return TYPE_PICK.test(span);
}

/** True when the sentence prints a pick "from among" into the hand. */
export function printsAmongPick(span: string): boolean {
    return PICK_REVEAL.test(span) || PICK_PUT.test(span);
}

/**
 * The pick sentence, whole: "You may reveal a creature card from among them
 * and put it into your hand" / "You may put a land card from among them into
 * your hand". `null` = the sentence prints no "from among" pick into the
 * hand, and is some other rule's to read.
 */
export function readAmongPickSentence(
    span: string,
    ctx: unknown
): RuleResult<AmongPickSentenceIR> | null {
    const revealed = span.match(PICK_REVEAL);
    const put = revealed === null ? span.match(PICK_PUT) : null;
    const match = revealed ?? put;
    if (match === null) return null;
    const pick = amongPickRule.run(match[1]!, ctx);
    if (!pick.ok) return pick;
    return ok({ pick: pick.value, reveal: revealed !== null });
}

function pickFilter(descriptor: DescriptorIR): EffectCardFilter | string {
    for (const [field, value] of Object.entries(descriptor))
        if (value !== undefined && !PICK_FIELDS.has(field))
            return `"${field}" is not a clause a pick from among them reads`;
    if (descriptor.card !== true) return 'the pick names a "card"';
    const filter: EffectCardFilter = {};
    // CR 205.2a — "a creature or land card": an or-list of types is a union,
    // which is what `EffectCardFilter.type` reads a list as.
    const types = descriptor.types;
    if (types !== undefined)
        filter.type = types.length === 1 ? types[0]! : [...types];
    const excluded = descriptor.excludeTypes;
    if (excluded !== undefined)
        filter.excludeType =
            excluded.length === 1 ? excluded[0]! : [...excluded];
    const subtypes = descriptor.subtypes;
    if (subtypes !== undefined) {
        if (subtypes.length !== 1)
            return "a pick from among them names one subtype";
        filter.subtype = subtypes[0]!;
    }
    // CR 105.2 — one colour word. Several would need the printed "or" the
    // descriptor does not record, so they are refused rather than guessed.
    const colors = descriptor.colors;
    if (colors !== undefined) {
        if (colors.length !== 1)
            return "a pick from among them names one colour";
        filter.color = colors[0]!;
    }
    if (Object.keys(filter).length === 0)
        return "a pick from among them names what card it takes";
    return filter;
}
