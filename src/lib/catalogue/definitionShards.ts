// The ONE loader of Definition Shards in a client graph (issue #5615, the
// compiled half by issue #5616; PRD #5602, ADR 0113 Amendments V–VI): which
// shards a surface needs resident, and making them so. The page and the Brain
// worker each run it in their own graph, over the same seams
// (`./set-modules.browser`, `./compiled-shards`), so the two cannot drift.
//
// A SHARD KEY names one thing to install:
//   - a hand-written Set code (`lea`) — that Set's lazily imported chunk;
//   - `compiled:<code>` — the compiled shard of first-printing Set `<code>`;
//   - `compiled-index` — the compiled Definition Index alone, no row: how a
//     compiled card outside every installed shard is LOCATED, since the game
//     path holds no catalogue-wide index (the Manifest carries each card's
//     shard key).
//
// Two modes, one loader:
//   - WHOLE — every Set and every compiled shard: the deck builder, deck
//     detail, the Draft Lab, admin tooling, the join antechamber —
//     `hydrateCatalogue`.
//   - PER-GAME — the shards of the game's Definition Manifest, then any shard
//     a definition on the board turns out to need (`shardsNeededFor`): a
//     debug placement before the widened Manifest arrives, or a card fetched
//     from outside the game (CR 400.11), loads on demand with the board held
//     back. The Brain worker runs this mode over ITS Manifest — its own
//     decklist, plus the human's at `expert` — and what each request names
//     (`./residentFor`, issue #5617).
//
// `getDefinition` stays synchronous (ADR 0113 §1). For a card whose shard is
// not resident the catalogue answers nothing: `tryGetDefinition` returns
// `null`, `getDefinition` throws `Card not found` as for any unknown id. So
// THE HOLD IS THE ONLY GUARANTEE: the gate and the board never read a
// snapshot before `installShards` has resolved for every shard it names.
import { parentIdOfTwin } from "@convex/cards/twinId";
import { isPackedRowId } from "@convex/cards/packedCorpus";
import {
    compiledShardKeyOf,
    handWrittenSetCodeOf,
    isCompiledIndexInstalled,
    isCompiledShardInstalled,
} from "@convex/cards/catalogue";
import { setModuleSource } from "./set-modules.browser";
import {
    installAllCompiledShards,
    installCompiledIndex,
    installCompiledShard,
    isKnownCompiledShard,
} from "./compiled-shards";
import { residencyVersion, subscribeResidency } from "./residency";

export { residencyVersion, subscribeResidency };

const COMPILED_PREFIX = "compiled:";

/** The shard key of the compiled index (no row). */
export const COMPILED_INDEX_KEY = "compiled-index";

/** The shard key of first-printing Set `code`'s compiled shard. */
export const compiledShardKey = (code: string): string =>
    `${COMPILED_PREFIX}${code}`;

/** Every hand-written Set code this client can install, in catalogue
 *  order. */
export function allSetCodes(): readonly string[] {
    return setModuleSource.codes;
}

/** Whether `code` names a hand-written Set this client's Definition Index
 *  knows. */
export function isKnownSetCode(code: string): boolean {
    return setModuleSource.codes.includes(code);
}

/** Whether the hand-written Set's chunk is resident in this graph. */
export function isSetResident(code: string): boolean {
    return setModuleSource.resident(code) !== undefined;
}

/** Whether what shard key `key` names is resident in this graph. */
export function isShardResident(key: string): boolean {
    if (key === COMPILED_INDEX_KEY) return isCompiledIndexInstalled();
    if (key.startsWith(COMPILED_PREFIX)) {
        return isCompiledShardInstalled(key.slice(COMPILED_PREFIX.length));
    }
    return isSetResident(key);
}

/**
 * The shard a definition id needs resident, or `undefined` when it needs
 * none: a token, a face-down sentinel, an id no catalogue holds. A twin (an
 * inset spell, a split half, a modal back face) needs its PARENT's shard —
 * the twin is minted from the parent.
 *
 * A hand-written card's Set is read off the client's hand-written index. A
 * compiled card's shard is read off whichever installed section knows it (a
 * shard, the compiled index); a compiled-shaped id none knows needs the
 * compiled index first, which then names its shard — or nothing, when the id
 * is not a catalogue card.
 */
export function shardNeededBy(definitionId: string): string | undefined {
    const id = parentIdOfTwin(definitionId) ?? definitionId;
    const set = handWrittenSetCodeOf(id);
    if (set !== undefined) return set;
    if (!isPackedRowId(id)) return undefined;
    const code = compiledShardKeyOf(id);
    if (code !== undefined) {
        return isKnownCompiledShard(code) ? compiledShardKey(code) : undefined;
    }
    return isCompiledIndexInstalled() ? undefined : COMPILED_INDEX_KEY;
}

/** The shards among those `definitionIds` need that are NOT resident yet,
 *  each once, in first-seen order. Empty = every definition is answerable
 *  now.
 *
 *  `version` is {@link residencyVersion} at the time of the call, passed by a
 *  React caller so that a memoised call (the React Compiler keys a call on its
 *  arguments) is recomputed when a shard becomes resident; the answer itself
 *  reads the residency state, never the number. */
export function shardsNeededFor(
    definitionIds: Iterable<string>,
    version: number = residencyVersion()
): string[] {
    void version;
    const needed = new Set<string>();
    for (const id of definitionIds) {
        const key = shardNeededBy(id);
        if (key !== undefined && !isShardResident(key)) needed.add(key);
    }
    return [...needed];
}

function installShard(key: string): Promise<unknown> {
    if (key === COMPILED_INDEX_KEY) return installCompiledIndex();
    if (key.startsWith(COMPILED_PREFIX)) {
        return installCompiledShard(key.slice(COMPILED_PREFIX.length));
    }
    return setModuleSource.install(key);
}

/** Make every shard in `keys` resident; resolves once all are. Already
 *  resident or in flight shards cost nothing; a rejection is not memoised. */
export async function installShards(keys: Iterable<string>): Promise<void> {
    await Promise.all([...new Set(keys)].map(installShard));
}

/** WHOLE mode: every hand-written Set and every compiled shard resident.
 *  Resolves with how many compiled cards were added. */
export async function installAllShards(): Promise<number> {
    const [added] = await Promise.all([
        installAllCompiledShards(),
        installShards(setModuleSource.codes),
    ]);
    return added;
}
