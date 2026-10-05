// The blade registry's Verdicts, for the `"use node"` review action.
//
// `verdictReviewActions.ts` is a Node action, and importing `registrySource`
// there re-emits the whole card registry and the compiled pool into the Node
// half of the push (issue #3444, ADR 0113 § Amendment). The registry is
// already resident in the isolate bundle, so the action reads it through here
// with `ctx.runQuery`, as `debugScenarios.ts` does for the scenario generator.

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { verdictsFromRegistry } from "./gre/ai/verdicts/registrySource";
import type { Verdict } from "./gre/ai/verdicts/types";

/** Every Verdict the blade registry yields (`verdictsFromRegistry`), the other
 *  half of the corpus the held-out split reads beside the store's judgements.
 *  The JSON round trip drops `undefined` fields, which a Convex value
 *  cannot carry. */
export const registryVerdicts = internalQuery({
    args: {},
    returns: v.any(),
    handler: async (): Promise<Verdict[]> =>
        JSON.parse(JSON.stringify(verdictsFromRegistry().verdicts)),
});
