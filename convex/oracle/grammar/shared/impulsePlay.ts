/**
 * Shared sub-grammar: IMPULSE PLAY — "You may play that card this turn" /
 * "Until the end of your next turn, you may play that card" (CR 601.2 + CR 305.1).
 *
 * The sentence after an exile that turns ONE just-exiled card into a card its
 * controller may play from exile for a window. It points at the exile before
 * it ("that card"), so alone it names nothing: `assembleSentences` folds it
 * onto an `exile-top-of-library` of exactly one card and refuses it anywhere
 * else. The plural form ("those cards", "them") needs a grant over a set, which
 * the lowering has no binding for — it stays unread.
 */

import { fail, ok, type RuleResult } from "../../rule";

/** The windows the `grantCastFromExile` Op can express. */
export type ImpulseWindowIR = "this-turn" | "until-end-of-your-next-turn";

export interface ImpulsePlayIR {
    readonly window: ImpulseWindowIR;
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

/** CR 305.1 — "play" (not "cast"): a land among the exiled cards is playable too. */
export function readImpulsePlaySentence(
    span: string
): RuleResult<ImpulsePlayIR> | null {
    const trailing = span.match(TRAILING);
    const leading = trailing === null ? span.match(LEADING) : null;
    if (trailing === null && leading === null) return null;
    const phrase = (trailing?.[1] ?? leading![1]!).toLowerCase();
    const window = WINDOWS.get(phrase);
    if (window === undefined)
        return fail(`"${phrase}" is not an impulse-play window`, span);
    return ok({ window });
}
