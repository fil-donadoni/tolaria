"use node";

// The game-end Verdict Proposal judge's search, in the NODE runtime (issue
// #10024; GLOSSARY.md § Verdict Proposal).
//
// A MEASUREMENT, not a second judge: ADR 0183 placed the Bot's search on the
// client because the server measured no faster, and names the reopening test —
// a server search at a third or less of desktop Chromium's time per
// iteration, a Node-runtime action being the untried candidate. This action
// runs the very search the default-runtime judge runs (`runVerdictJudge`, the
// Brain's request handler at a fixed iteration budget and seed), so the two
// runtimes are timed on the same kind of positions and give the same move.
//
// INTERNAL, and never called first. The public action
// (`verdictJudge.judgePosition`) bounds the payload and claims the consult
// through the guard (`verdictJudgeGuard.claimJudgeConsult`: authenticated,
// the human seat, the game over, the clamped budget, the per-game and per-user
// bounds) in the default runtime, then hands the search here for the games
// `verdictJudgeRuntime` routes to Node. No client can reach this action, and
// none can choose it.
//
// THE NODE SEAM'S ONE EXCEPTION (ADR 0113 § Amendment, issue #3444). Convex
// bundles `"use node"` modules in a separate esbuild graph, so this file ships
// the engine and the compiled card catalogue a SECOND time in the pushed
// bundle. That is the price of the measurement, approved by the owner with
// the bundle-size delta in the PR (issue #10024), and
// `scripts/__tests__/convex-node-bundle-seam.test.ts` admits exactly this
// module. If Node does not pass the reopening test, this file is deleted
// (PRD issue #10017 § Node judge) and the exception with it.
//
// Node's per-call memory is 512 MiB, against the default runtime's 64 MiB.

import { internalAction } from "./_generated/server";
import type { PublicGameState } from "./gameProjections";
import {
    judgeSearchArgs,
    runVerdictJudge,
    verdictJudgeSearchValidator,
    type VerdictJudgeSearchResult,
} from "./verdictJudge";

/** Search ONE already-authorized position in the Node runtime. Never throws
 *  for a search failure (`runVerdictJudge` lowers it to `search-error`). */
export const searchPosition = internalAction({
    args: judgeSearchArgs,
    returns: verdictJudgeSearchValidator,
    handler: async (_ctx, args): Promise<VerdictJudgeSearchResult> =>
        runVerdictJudge({
            state: args.state as PublicGameState,
            botId: args.botId,
            knowledge: args.knowledge,
            iterations: args.iterations,
            seed: args.seed,
        }),
});
