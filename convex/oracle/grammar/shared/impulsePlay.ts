/**
 * Shared sub-grammar: IMPULSE PLAY — "You may play that card this turn" /
 * "Until the end of your next turn, you may play that card" / "Until the end
 * of your next turn, you may play those cards" (CR 601.2 + CR 305.1).
 *
 * The sentence after an exile that turns the just-exiled card(s) into cards
 * their controller may play from exile for a window. It points at the exile
 * before it ("that card", "those cards"), so alone it names nothing:
 * `assembleSentences` folds it onto a frame chain whose one library-top exile
 * moves exactly the number of cards the referent names — one for "that card",
 * more than one (or an unprinted X) for "those cards" — and refuses it
 * anywhere else. The plural is read only in the leading "until the end of
 * your next turn" form, the one the corpus prints; its trailing and
 * this-turn neighbours stay unread until a card earns them.
 */

import { fail, ok, type RuleResult } from "../../rule";

/** The windows the `grantCastFromExile` Op can express. */
export type ImpulseWindowIR = "this-turn" | "until-end-of-your-next-turn";

/** How many exiled cards the sentence names: "that card" / "it" name one,
 *  "those cards" names every card the exile moved (CR 608.2c). */
export type ImpulseReferentIR = "one" | "several";

export interface ImpulsePlayIR {
    readonly window: ImpulseWindowIR;
    readonly referent: ImpulseReferentIR;
}

const WINDOWS: ReadonlyMap<string, ImpulseWindowIR> = new Map([
    ["this turn", "this-turn"],
    ["until end of turn", "this-turn"],
    ["until the end of your next turn", "until-end-of-your-next-turn"],
]);

/** "You may play that card <window>" — the window trails the clause. */
const TRAILING = /^You may play (?:that card|it) (.+)$/;
/** "<Window>, you may play that card" — the window leads the clause. */
const LEADING = /^(Until .+?|This turn), you may play (?:that card|it)$/;
/** "Until the end of your next turn, you may play those cards" — the plural
 *  referent, in the one window the corpus prints it with. */
const LEADING_PLURAL =
    /^Until the end of your next turn, you may play those cards$/;

/** CR 305.1 — "play" (not "cast"): a land among the exiled cards is playable too. */
export function readImpulsePlaySentence(
    span: string
): RuleResult<ImpulsePlayIR> | null {
    if (LEADING_PLURAL.test(span))
        return ok({
            window: "until-end-of-your-next-turn",
            referent: "several",
        });
    const trailing = span.match(TRAILING);
    const leading = trailing === null ? span.match(LEADING) : null;
    if (trailing === null && leading === null) return null;
    const phrase = (trailing?.[1] ?? leading![1]!).toLowerCase();
    const window = WINDOWS.get(phrase);
    if (window === undefined)
        return fail(`"${phrase}" is not an impulse-play window`, span);
    return ok({ window, referent: "one" });
}
