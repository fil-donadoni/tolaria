// The game-end Verdict Proposal judge, client half: one server action call per
// sampled decision (`convex/verdictJudge.ts`).
//
// The judge runs on the server, never on the player's device: its search is
// an ITERATION-only budget with a fixed seed, so the same position gets the
// same answer on any machine, and a slow device neither grinds through it
// after the game nor leaves a backlog in front of the next game's Bot. The
// client sends the captured position and gets the move back; it opens no
// Brain Worker.
//
// A failed call costs that one decision, never the review: a rejection by the
// server's guard (`ConvexError`) or any other failure (network, deploy, an
// action that threw) settles the consult as "no answer", counted in the tally
// the proposal-count report carries. Each answered call also records the
// server's own search time and the client's round trip — their difference is
// cold start, module load and network — for the same report.

import { ConvexError } from "convex/values";
import type { ConvexReactClient } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { BrainJudge } from "./verdict-proposals";
import type {
    JudgeOutcomeTally,
    JudgeTimings,
} from "./verdict-proposal-telemetry";

/** The slice of the Convex client the judge calls. */
export type JudgeClient = Pick<ConvexReactClient, "action">;

export type VerdictJudge = {
    /** The `BrainJudge` `proposeVerdicts` consults. */
    judge: BrainJudge;
    /** How each consult ended, for the proposal-count report (issue #8732). */
    tally: JudgeOutcomeTally;
    /** Per answered consult: server search time and round trip. */
    timings: JudgeTimings;
    /** End this game's judging: a consult started afterwards is not sent.
     *  Idempotent. */
    close: () => void;
};

/** Open the server judge for one game end. */
export function openVerdictJudge(
    client: JudgeClient,
    gameId: Id<"games">
): VerdictJudge {
    const tally: JudgeOutcomeTally = {};
    const timings: JudgeTimings = { serverMs: [], roundTripMs: [] };
    let closed = false;
    const count = (outcome: keyof JudgeOutcomeTally) => {
        tally[outcome] = (tally[outcome] ?? 0) + 1;
    };
    const judge: BrainJudge = async (source, budget, seed) => {
        if (closed) return null;
        const start = performance.now();
        try {
            const r = await client.action(api.verdictJudge.judgePosition, {
                gameId,
                state: source.state,
                botId: source.botId,
                // Exactly the validator's fields: a stray property on a
                // knowledge entry would fail the call's argument validation.
                ...(source.knowledge
                    ? {
                          knowledge: source.knowledge.map((k) => ({
                              playerId: k.playerId,
                              cardIds: k.cardIds,
                          })),
                      }
                    : {}),
                iterations: budget.iterations,
                seed,
            });
            timings.roundTripMs.push(performance.now() - start);
            timings.serverMs.push(r.searchMs);
            count(r.outcome);
            return r.outcome === "move" ? r.move : null;
        } catch (cause: unknown) {
            count(
                cause instanceof ConvexError
                    ? "server-rejected"
                    : "server-error"
            );
            return null;
        }
    };
    return {
        judge,
        tally,
        timings,
        close: () => {
            closed = true;
        },
    };
}
