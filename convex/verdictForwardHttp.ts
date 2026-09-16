// The writer's forward route (issue #3745, ADR 0128 § Amendment): the HTTP
// door a deployment without the write key forwards its outbox through.
//
// It decides nothing — `verdictForward.ts` does. This binds the decisions to
// the writer's environment (the accepted tokens), to `verdicts.submit`'s own
// checks (`verdicts:forwardAdmissible`) and to the `"use node"` uploads
// (`verdictsDrain:storeForwarded*`). References are by name: the drain is a
// node module, and `verdicts.ts` reaches the card registry.

import { makeFunctionReference } from "convex/server";
import { httpAction } from "./_generated/server";
import {
    VERDICT_STORE_FORWARD_TOKENS_ENV,
    acceptForward,
    parseForwardTokenRegistry,
} from "./verdictForward";
import type { OutboxStoreResult } from "./verdictsOutbox";
import type { ResolutionStoreResult } from "./verdictResolutionsOutbox";

const refs = {
    forwardAdmissible: makeFunctionReference<
        "query",
        Record<string, unknown>,
        null
    >("verdicts:forwardAdmissible"),
    storeForwardedVerdict: makeFunctionReference<
        "action",
        { row: unknown },
        OutboxStoreResult
    >("verdictsDrain:storeForwardedVerdict"),
    storeForwardedResolution: makeFunctionReference<
        "action",
        { row: unknown },
        ResolutionStoreResult
    >("verdictsDrain:storeForwardedResolution"),
};

export const forwardVerdicts = httpAction(async (ctx, request) => {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        body = undefined;
    }
    const { httpStatus, response } = await acceptForward(
        {
            registry: () =>
                parseForwardTokenRegistry(
                    process.env[VERDICT_STORE_FORWARD_TOKENS_ENV]
                ),
            checkAdmissible: async (judgement) => {
                await ctx.runQuery(refs.forwardAdmissible, judgement);
            },
            storeVerdict: (row) =>
                ctx.runAction(refs.storeForwardedVerdict, { row }),
            storeResolution: (row) =>
                ctx.runAction(refs.storeForwardedResolution, { row }),
        },
        request.headers.get("authorization"),
        body
    );
    return new Response(JSON.stringify(response), {
        status: httpStatus,
        headers: { "content-type": "application/json" },
    });
});
