// The game-end Verdict Proposal judge's Brain (issue #9514).
//
// The judge consults the Brain once per sampled decision, at an
// ITERATION-only budget so its answers are reproducible. A Brain Worker serves
// one request at a time and does not cancel a consult that timed out, so on a
// slow device a judge sharing the Bot's Worker left a backlog of uncapped
// searches the next game's Bot queued behind: every Bot consult timed out and
// the Bot passed a whole Bo3 Game 2. The judge therefore runs on a channel of
// its own (`createBrainChannel(JUDGE_CHANNEL)`), opened for one game end and
// closed when it is done — the only way the judge reaches the Brain.

import type { BrainJudge } from "./verdict-proposals";
import type { JudgeOutcomeTally } from "./verdict-proposal-telemetry";
import { createBrainChannel, JUDGE_CHANNEL } from "./brain-client";

export type VerdictJudge = {
    /** The `BrainJudge` `proposeVerdicts` consults. */
    judge: BrainJudge;
    /** How each consult ended, for the proposal-count report (issue #8732). */
    tally: JudgeOutcomeTally;
    /** Terminate the judge's Worker. Idempotent. */
    close: () => void;
};

/** Open the judge's own Brain for one game end. */
export function openVerdictJudge(): VerdictJudge {
    const brain = createBrainChannel(JUDGE_CHANNEL);
    const tally: JudgeOutcomeTally = {};
    const judge: BrainJudge = (source, budget, seed) =>
        brain
            .consult(
                source.state,
                source.botId,
                budget,
                source.knowledge,
                undefined,
                seed
            )
            .then((r) => {
                tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
                return r.outcome === "move" ? r.move : null;
            });
    return { judge, tally, close: () => brain.dispose() };
}
