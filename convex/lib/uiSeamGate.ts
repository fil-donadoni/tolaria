/**
 * The double gate every `check:ui` seam server function opens on (issue
 * #9271, ADR 0180).
 *
 * The client gate (`import.meta.env.DEV`) keeps the seam's ROUTES out of a
 * production bundle, but a Convex function deploys to EVERY deployment and is
 * callable by anyone holding the deployment URL — so this is the real
 * boundary. A seam function runs only when BOTH hold:
 *
 *   1. the deployment is local (`CONVEX_CLOUD_URL`, the same fail-closed check
 *      the lane-account functions use: missing or unparsable → refused);
 *   2. the caller is signed in as a `check:ui` lane account
 *      (`ui-gate+<runId>@ui-gate.invalid`). Admin alone is NOT enough: an
 *      admin is a real person on a real deployment, a lane account exists only
 *      for the length of one lane run.
 *
 * Ordered cheapest-first so a refusal touches nothing it does not have to:
 * the deployment check reads only the environment, the sign-in check only the
 * auth token, and the one `users` read is the gate's own — no seam handler
 * code, read or write, runs before all three pass. Each refusal names the
 * condition that failed.
 *
 * `convex/__tests__/uiSeam.test.ts` proves both refusals against the real
 * handlers; its static half reds when a function in `convex/uiSeam.ts` does not
 * open on {@link assertUiSeamCaller}.
 */
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc } from "../_generated/dataModel";
import { auth } from "../auth";
import { isLaneAccountEmail, isLocalDeploymentUrl } from "./uiGateLaneAccount";

type SeamCtx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

export const UI_SEAM_REFUSED = "ui seam refused";

/** Throws unless the deployment is local AND the caller is a lane account;
 *  returns the caller's user row. Every `convex/uiSeam.ts` handler's FIRST
 *  statement. */
export async function assertUiSeamCaller(ctx: SeamCtx): Promise<Doc<"users">> {
    const url = process.env.CONVEX_CLOUD_URL;
    if (!isLocalDeploymentUrl(url)) {
        throw new Error(
            `${UI_SEAM_REFUSED}: deployment is not local (CONVEX_CLOUD_URL ${JSON.stringify(url ?? null)})`
        );
    }
    const userId = await auth.getUserId(ctx);
    if (!userId) {
        throw new Error(`${UI_SEAM_REFUSED}: caller is not signed in`);
    }
    const user = await ctx.db.get(userId);
    if (!user || !isLaneAccountEmail(user.email)) {
        throw new Error(
            `${UI_SEAM_REFUSED}: caller is not a check:ui lane account (ui-gate+<runId>@ui-gate.invalid)`
        );
    }
    return user;
}
