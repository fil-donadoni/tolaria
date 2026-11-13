// The `check:ui` lane's test-only seam — its server half (issue #9271,
// ADR 0180).
//
// THE ONE MODULE lane shortcuts' queries and mutations live in. A shortcut
// that jumps the lane straight to a state (a declared position, the end of a
// mocked draft, sideboarding between games) adds its function HERE, and
// nowhere else, so it inherits the security model instead of re-deciding it.
//
// THE CONTRACT, enforced by `convex/__tests__/uiSeam.test.ts`:
//   - every export is a public `query` or `mutation` (no action: the gate
//     reads `ctx.db`; no internal function: deploy access needs no seam);
//   - every handler's FIRST statement awaits `assertUiSeamCaller(ctx)` —
//     local deployment AND lane account, before any read or write of its own
//     (`lib/uiSeamGate.ts`).
//
// Client routes and query parameters that call these live under the shared
// namespace (`lib/uiSeamNamespace.ts`), registered only in a DEV bundle.
import { v } from "convex/values";
import { query } from "./_generated/server";
import { assertUiSeamCaller } from "./lib/uiSeamGate";
import { runIdOfLaneEmail } from "./lib/uiGateLaneAccount";

/** The trivial seam function: proves both gates end to end and touches no
 *  state. The echo route (`/__uiseam/echo`) renders its answer. */
export const echo = query({
    args: { value: v.optional(v.string()) },
    returns: v.object({
        runId: v.union(v.string(), v.null()),
        value: v.union(v.string(), v.null()),
    }),
    handler: async (ctx, args) => {
        const user = await assertUiSeamCaller(ctx);
        return {
            runId: user.email ? runIdOfLaneEmail(user.email) : null,
            value: args.value ?? null,
        };
    },
});
