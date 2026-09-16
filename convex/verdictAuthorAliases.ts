"use node";

// The author-alias writer (issue #3585, ADR 0128 §4) — joins two
// `${deployment}:${userId}` authors who are one person, so their judgements
// aggregate in `bun run verdicts:testers`.
//
// INTERNAL, like `verdictsPack.writePack`, and for the same reason: it is run
// by the owner with a deploy key (`npx convex run verdictAuthorAliases:record`
// against the deployment holding the write key), which already carries admin
// rights; no user identity or browser has a reason to reach it. The alias
// lives in the bucket, never in git — the repository is public, and a mapping
// of accounts to one human is what the bucket is private for.
//
// It decides nothing: `verdictStore.ts` names, encodes and verifies. The write
// is re-read before it is reported, as the outbox's is.

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import {
    VerdictStoreIntegrityError,
    decodeAliasObject,
    putAlias,
} from "./verdictStore";
import { verdictStoreWriterFromDeploymentEnv } from "./verdictStoreGcsWriter";

export const record = internalAction({
    args: { authors: v.array(v.string()) },
    returns: v.object({
        name: v.string(),
        outcome: v.union(v.literal("created"), v.literal("exists")),
    }),
    handler: async (_ctx, args) => {
        const [a, b, ...rest] = args.authors;
        if (a === undefined || b === undefined || rest.length > 0) {
            throw new Error("an alias joins exactly two authors");
        }
        const store = verdictStoreWriterFromDeploymentEnv();
        const { name, outcome } = await putAlias(store, { authors: [a, b] });
        const bytes = await store.get(name);
        if (bytes === null) {
            throw new VerdictStoreIntegrityError(
                name,
                "stored but not readable"
            );
        }
        decodeAliasObject(name, bytes);
        return { name, outcome };
    },
});
