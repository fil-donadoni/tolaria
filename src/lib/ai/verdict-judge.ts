// The game-end Verdict Proposal judge: the Brain's move on each sampled
// position, asked on this device (`judge-brain.ts`) — ADR 0183 Amendment I.
//
// Its Workers are its own, so a judge consult never queues in front of the
// Bot's, and they answer at a fixed iteration budget and seed, so the same
// position gets the same answer on any device. A consult that fails costs that
// one decision, never the review and never the game: it settles as "no answer"
// and is counted in the tally the proposal-count report carries, beside the
// timings of every answered one.

import type { DefinitionManifestEntry } from "@convex/definitionManifestEntry";
import type { BrainJudge } from "./verdict-proposals";
import type {
    JudgeOutcomeTally,
    JudgeTimings,
} from "./verdict-proposal-telemetry";
import { isMobileDevice } from "./bot-search-telemetry";
import { judgeWorkerCount, openJudgeBrain } from "./judge-brain";

export type VerdictJudge = {
    /** The `BrainJudge` `proposeVerdicts` consults. */
    judge: BrainJudge;
    /** How each consult ended, for the proposal-count report (issue #8732). */
    tally: JudgeOutcomeTally;
    /** Per answered consult: the search's own time, and the wait for it. */
    timings: JudgeTimings;
    /** Hand the judge the game's Definition Manifest. */
    prime: (entries: readonly DefinitionManifestEntry[]) => void;
    /** End this game's judging: the Workers stop at once, and a consult in
     *  flight or started afterwards has no answer. Idempotent. */
    close: () => void;
};

/** Open the judge for one game. No Worker starts before the first consult. */
export function openVerdictJudge(): VerdictJudge {
    const tally: JudgeOutcomeTally = {};
    const timings: JudgeTimings = { searchMs: [], waitMs: [] };
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    const brain = openJudgeBrain(
        judgeWorkerCount(nav?.hardwareConcurrency, isMobileDevice(nav))
    );
    const judge: BrainJudge = async (source, budget, seed) => {
        const start = performance.now();
        const answer = await brain.consult({
            state: source.state,
            botId: source.botId,
            iterations: budget.iterations,
            seed,
            deckKnowledge: source.knowledge,
        });
        // The game was left: nobody reads this, and it is no failure.
        if (answer.closed) return null;
        tally[answer.outcome] = (tally[answer.outcome] ?? 0) + 1;
        if (answer.outcome !== "move") return null;
        timings.waitMs.push(performance.now() - start);
        if (answer.searchMs !== undefined) {
            timings.searchMs.push(answer.searchMs);
        }
        return answer.move;
    };
    return { judge, tally, timings, prime: brain.prime, close: brain.close };
}
