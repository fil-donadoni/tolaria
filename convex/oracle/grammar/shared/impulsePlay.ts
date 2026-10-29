/**
 * Shared sub-grammar: IMPULSE PLAY — "You may play that card this turn" /
 * "Until the end of your next turn, you may play that card" (CR 601.2 + CR 305.1).
 *
 * The sentence after an exile that turns ONE just-exiled card into a card its
 * controller may play from exile for a window. It points at the exile before
 * it ("that card"), so alone it names nothing: `assembleSentences` folds it
 * onto a frame chain whose one library-top exile moves exactly one card, and
 * refuses it anywhere else. The plural form ("those cards", "them") needs a grant over a set, which
 * the lowering has no binding for — it stays unread.
 */

import { fail, ok, type RuleResult } from "../../rule";
import type { EffectSentenceIR } from "./effectClause";

/** The windows the `grantCastFromExile` Op can express. */
export type ImpulseWindowIR = "this-turn" | "until-end-of-your-next-turn";

export interface ImpulseWindowPlayIR {
    readonly window: ImpulseWindowIR;
    readonly during?: undefined;
}

/**
 * CR 608.2g — "You may cast that card." with no stated duration: the cast is
 * offered during the resolution of the ability that exiled the card and the
 * permission ends with it. `declined` is the "If you don't, <effect>."
 * sentence folded behind it by `assembleSentences`.
 */
export interface ResolutionCastIR {
    readonly during: "resolution";
    readonly declined?: EffectSentenceIR;
}

export type ImpulsePlayIR = ImpulseWindowPlayIR | ResolutionCastIR;

const WINDOWS: ReadonlyMap<string, ImpulseWindowIR> = new Map([
    ["this turn", "this-turn"],
    ["until end of turn", "this-turn"],
    ["until the end of your next turn", "until-end-of-your-next-turn"],
]);

/** "You may play that card <window>" — the window trails the clause. */
const TRAILING = /^You may play (?:that card|it) (.+)$/;
/** "<Window>, you may play that card" — the window leads the clause. */
const LEADING = /^(Until .+?|This turn), you may play (?:that card|it)$/;

/** CR 608.2g — "You may cast that card." with no duration: cast, never play. */
const DURING_RESOLUTION = /^You may cast (?:that card|it)$/;

/** CR 305.1 — "play" (not "cast"): a land among the exiled cards is playable too. */
export function readImpulsePlaySentence(
    span: string
): RuleResult<ImpulsePlayIR> | null {
    if (DURING_RESOLUTION.test(span)) return ok({ during: "resolution" });
    const trailing = span.match(TRAILING);
    const leading = trailing === null ? span.match(LEADING) : null;
    if (trailing === null && leading === null) return null;
    const phrase = (trailing?.[1] ?? leading![1]!).toLowerCase();
    const window = WINDOWS.get(phrase);
    if (window === undefined)
        return fail(`"${phrase}" is not an impulse-play window`, span);
    return ok({ window });
}
