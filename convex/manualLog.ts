// Manual Log query (ADR 0080 S10) — paginated log for the client.
// Separated from convex/manual.ts to keep that module client-importable
// without pulling _generated/server into the browser bundle.

import { v } from "convex/values";
import {
    paginationOptsValidator,
    paginationResultValidator,
} from "convex/server";
import { query } from "./_generated/server";

export const getManualLog = query({
    args: {
        gameId: v.id("games"),
        paginationOpts: paginationOptsValidator,
    },
    returns: paginationResultValidator(v.any()),
    handler: async (ctx, args) => {
        return await ctx.db
            .query("manualLog")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .order("desc")
            .paginate(args.paginationOpts);
    },
});
