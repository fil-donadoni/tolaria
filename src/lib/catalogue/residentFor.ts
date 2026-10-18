// Making a set of definition ids resident from Manifest HINTS (issue #5617,
// PRD #5602): what a client graph with no board — the Brain worker — runs
// before it reads `getDefinition` synchronously.
//
// The board learns where a card lives from its Definition Manifest rows
// (`./manifestShardKeys`) and holds a snapshot on `shardsNeededFor`
// (`useDefinitionsResident`). A graph that is handed ids rather than rows
// does both at once: the Manifest entries it was given are HINTS (definition
// id → Set code), so a compiled card is located without the catalogue-wide
// compiled index (≈ 175 KB gzip); a hand-written card by the client's own
// index, as everywhere. Only a card outside every hint — a debug placement, a
// card fetched from outside the game — pays for the index, which then names
// its shard.
import { parentIdOfTwin } from "@convex/cards/twinId";
import type { DefinitionManifestEntry } from "@convex/definitionManifestEntry";
import {
    COMPILED_INDEX_KEY,
    installShards,
    isShardResident,
    shardNeededBy,
} from "./definitionShards";
import { entryShardKey } from "./manifestShardKeys";

/** Definition id → the Set code its Manifest entry names. */
export type ShardHints = Map<string, string>;

/** Record `entries`' Set codes in `hints`; returns the shards they name, each
 *  once — the ones this build serves (`entryShardKey`). */
export function hintedShardKeys(
    entries: readonly DefinitionManifestEntry[],
    hints: ShardHints
): string[] {
    const keys = new Set<string>();
    for (const entry of entries) {
        hints.set(entry.definitionId, entry.setCode);
        const key = entryShardKey(entry);
        if (key !== undefined) keys.add(key);
    }
    return [...keys];
}

/** The shards `ids` need that are not resident, each once. A compiled card no
 *  installed section knows is located by its hint when it has one; only a
 *  card outside every hint needs the compiled index (which names its shard on
 *  the next round of {@link makeResident}). */
export function shardsMissingFor(
    ids: Iterable<string>,
    hints: ReadonlyMap<string, string>
): string[] {
    const keys = new Set<string>();
    for (const id of ids) {
        let key = shardNeededBy(id);
        if (key === COMPILED_INDEX_KEY) {
            const definitionId = parentIdOfTwin(id) ?? id;
            const setCode = hints.get(definitionId);
            const hinted =
                setCode === undefined
                    ? undefined
                    : entryShardKey({ definitionId, setCode });
            // A hinted shard already resident that still does not know the
            // card was the wrong hint (server and client deploys are not
            // atomic): locate it through the index instead.
            if (hinted !== undefined && !isShardResident(hinted)) key = hinted;
        }
        if (key !== undefined && !isShardResident(key)) keys.add(key);
    }
    return [...keys];
}

/** Rounds of {@link makeResident}: the hinted shards, then — for a hint that
 *  named the wrong shard, or a card no hint names — the compiled index, then
 *  the shard the index names. */
const MAX_ROUNDS = 4;

/** Install every shard `ids` need; resolves once `getDefinition` answers each
 *  id a catalogue holds. Rejects when an install does. */
export async function makeResident(
    ids: readonly string[],
    hints: ReadonlyMap<string, string>
): Promise<void> {
    for (let round = 0; round < MAX_ROUNDS; round++) {
        const missing = shardsMissingFor(ids, hints);
        if (missing.length === 0) return;
        await installShards(missing);
    }
}
