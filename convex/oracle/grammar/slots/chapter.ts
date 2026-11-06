/**
 * Slot: a Saga's chapter lines (CR 714.2).
 *
 * CR 714.2b — "{rN}—[Effect]" is a triggered ability, but the head is a symbol
 * rather than a sentence, so no trigger head can read it and the effect prints
 * at sentence casing like an activated ability's. CR 714.2c — "{rN1}, {rN2}—"
 * is one line with several numerals, and lowers to ONE ability that fires on
 * each of them.
 *
 * Gated on the Saga subtype (CR 205.3h) because a Roman numeral heading a line
 * means nothing elsewhere. The numerals are read exactly, strictly ascending:
 * a neighbour ("I Denial — …") is no chapter this slot reads, so it stays a gap
 * of its own and refuses the card.
 */

import { fail, listOf, ok, rule, terminated, type Rule } from "../../rule";
import {
    assembleSentences,
    assemblyTrace,
    sentenceRule,
} from "../shared/effectClause";
import type { ParseContext } from "../../types";
import type { SlotIR } from "../ir";

export const CHAPTER_SLOT = "chapter";

const SAGA_SUBTYPE = "Saga";

/** CR 714.2a — a chapter symbol's numeral, as far as any printed Saga counts. */
const CHAPTER_NUMERALS: Readonly<Record<string, number>> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
};

/** CR 714.2b / 714.2c — the numerals, then the em dash, then the effect. */
const CHAPTER_LINE = /^([IVX]+(?:, [IVX]+)*) — (.+)$/;

/**
 * CR 207.2d — a flavor word heading the effect has no rules meaning. Printed as
 * a title, which is what tells it from a head that does mean something: "Target
 * opponent faces a villainous choice — …" is an instruction, and stays refused.
 */
const FLAVOR_WORD_HEAD =
    /^[A-Z][^\s\u2014.,"]*(?: (?:of|the|and|in|to|for|[A-Z][^\s\u2014.,"]*))* \u2014 ([^\u2014]+)$/;

/** The chapter numbers a printed head names, or null if any is no numeral or
 *  they do not ascend. */
function readChapters(head: string): readonly number[] | null {
    const chapters: number[] = [];
    for (const numeral of head.split(", ")) {
        const chapter = CHAPTER_NUMERALS[numeral];
        if (chapter === undefined) return null;
        if (chapter <= (chapters[chapters.length - 1] ?? 0)) return null;
        chapters.push(chapter);
    }
    return chapters;
}

const chapterBody: Rule<SlotIR> = rule(CHAPTER_SLOT, (span, ctx) => {
    if (!(ctx as ParseContext).typeLine.subtypes.includes(SAGA_SUBTYPE))
        return fail("a chapter line on a card that is not a Saga", span);
    const line = CHAPTER_LINE.exec(span);
    if (line === null) return fail("not a chapter line", span);
    const chapters = readChapters(line[1]!);
    if (chapters === null) return fail("not a chapter numeral", span);
    const flavored = FLAVOR_WORD_HEAD.exec(line[2]!);
    const parsed = listOf("effect sentences", ". ", sentenceRule).run(
        flavored === null ? line[2]! : flavored[1]!,
        ctx
    );
    if (!parsed.ok) return parsed;
    const assembled = assembleSentences(parsed.value, {
        site: "chapter",
        rejectRestrictions:
            "an activation restriction (CR 602.5) has no meaning on a triggered ability",
    });
    if (!assembled.ok)
        return fail(
            assembled.reason,
            span,
            assemblyTrace(span, parsed.value.length)
        );
    return ok({
        kind: "chapter" as const,
        chapters,
        effects: assembled.effects,
    });
});

/** The ability's own full stop closes the line, as on a triggered ability. */
export const chapterSlot: Rule<SlotIR> = terminated(".", chapterBody);
