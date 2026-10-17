import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { handWrittenSetCodeOf } from "@convex/cards/catalogue";
import { compiledShardKey, isKnownSetCode } from "./definitionShards";
import { isKnownCompiledShard } from "./compiled-shards";

/** One seat's Definition Manifest as `gameReads.getDefinitionManifest`
 *  returns it, or `undefined` while loading. */
export type ManifestRow =
    | FunctionReturnType<typeof api.gameReads.getDefinitionManifest>
    | undefined;

/** The shard key of one Manifest entry, or `undefined` when this client
 *  serves no shard for it.
 *
 *  A card THIS client's hand-written index knows is installed by its own
 *  index's Set (issue #5615) — the entry's `setCode` is a hint frozen at the
 *  Game's build from the server's index, and server and client deploys are
 *  not atomic. Any other card is compiled: its `setCode` IS the key of the
 *  shard that holds its row (issue #5616), when this build serves one. A
 *  hint that turns out wrong is caught on the board by
 *  `useDefinitionsResident`, which locates the card through the compiled
 *  index — for a card this build knows; one only a newer server knows
 *  resolves nowhere (the client is out of date). */
function entryShardKey(entry: {
    definitionId: string;
    setCode: string;
}): string | undefined {
    const set = handWrittenSetCodeOf(entry.definitionId);
    if (set !== undefined) return isKnownSetCode(set) ? set : undefined;
    return isKnownCompiledShard(entry.setCode)
        ? compiledShardKey(entry.setCode)
        : undefined;
}

/** The shards the Manifest rows ask for, each once, in row order — only the
 *  ones THIS client serves (issue #5615: hand-written Sets; issue #5616:
 *  compiled shards). An entry with no shard here is dropped, and the card
 *  behind it is caught on the board by `useDefinitionsResident`. */
export function manifestShardKeys(rows: readonly ManifestRow[]): string[] {
    const keys = new Set<string>();
    for (const row of rows) {
        for (const entry of row?.entries ?? []) {
            const key = entryShardKey(entry);
            if (key !== undefined) keys.add(key);
        }
    }
    return [...keys];
}
