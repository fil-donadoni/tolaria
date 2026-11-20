import type { VerdictJudging } from "./verdict-proposal-store";

/** The game-over line while the game-end judge runs (issue #10229): the
 *  consult count once the sample is drawn, a bare line before. */
export function verdictJudgingLabel(judging: VerdictJudging): string {
    return judging.total === null
        ? "Judging your decisions…"
        : `Judging your decisions… (${judging.done}/${judging.total})`;
}
