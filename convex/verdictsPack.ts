"use node";

// The pack writer (issue #3583, ADR 0128 §7 / §9) — the one store write a
// promotion needs, run where the write credential lives.
//
// INTERNAL, deliberately. `bun run verdicts:promote` calls it with a deploy key
// (`npx convex run --prod`, `scripts/lib/verdict-promotion-run.ts`), which
// already carries admin rights over the deployment; no user identity, no
// browser and no other function has a reason to reach it.
//
// It decides nothing: `verdictPackStore.ts` reads the named verdicts back,
// encodes, stores and re-reads. `"use node"` for the GCS writer's JWT signing
// and for `node:zlib`; its import graph stays clear of the card registry
// (`scripts/__tests__/convex-node-bundle-seam.test.ts`).

import { v } from "convex/values";
import { gunzipSync, gzipSync } from "node:zlib";
import { internalAction } from "./_generated/server";
import { storeVerdictPack } from "./verdictPackStore";
import { verdictStoreWriterFromDeploymentEnv } from "./verdictStoreGcsWriter";

/** The most a re-read pack may gunzip to — the machine reader's ceiling
 *  (`scripts/lib/verdict-pack-cache.ts`). */
const MAX_PACK_BYTES = 1024 ** 3;

export const writePack = internalAction({
    args: { verdictIds: v.array(v.string()) },
    returns: v.object({
        packHash: v.string(),
        name: v.string(),
        verdicts: v.number(),
        outcome: v.union(v.literal("created"), v.literal("exists")),
    }),
    handler: async (_ctx, args) =>
        await storeVerdictPack(
            verdictStoreWriterFromDeploymentEnv(),
            args.verdictIds,
            {
                gzip: (text) => new Uint8Array(gzipSync(text)),
                gunzip: (bytes) =>
                    gunzipSync(bytes, {
                        maxOutputLength: MAX_PACK_BYTES,
                    }).toString("utf8"),
            }
        ),
});
