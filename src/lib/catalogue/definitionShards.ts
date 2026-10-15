// The ONE loader of Definition Shards in a client graph (issue #5615, PRD
// #5602, ADR 0113 Amendment V): which hand-written Sets a surface needs
// resident, and making them so. The page and the Brain worker each run it in
// their own graph, over the same seam (`./set-modules.browser`), so the two
// cannot drift.
//
// Two modes, one loader:
//   - WHOLE — every Set: the deck builder, deck detail, the Draft Lab, admin
//     tooling, the join antechamber, the Brain worker (until its own slice),
//     and today's catalogue gate (`hydrateCatalogue`).
//   - PER-GAME — the Sets of the game's Definition Manifest, then any Set a
//     definition on the board turns out to need (`setsNeededFor`): a debug
//     placement before the widened Manifest arrives, or a card fetched from
//     outside the game (CR 400.11), loads on demand with the board held back.
//
// `getDefinition` stays synchronous (ADR 0113 §1). For a card whose Set is
// not resident the catalogue answers nothing: `tryGetDefinition` returns
// `null`, `getDefinition` throws `Card not found` as for any unknown id. So
// THE HOLD IS THE ONLY GUARANTEE: the gate and the board never read a
// snapshot before `installSets` has resolved for every Set it names.
import { parentIdOfTwin } from "@convex/cards/twinId";
import { handWrittenSetCodeOf } from "@convex/cards/catalogue";
import {
    residencyVersion,
    setModuleSource,
    subscribeResidency,
} from "./set-modules.browser";

export { residencyVersion, subscribeResidency };

/** Every Set code this client can install, in catalogue order. */
export function allSetCodes(): readonly string[] {
    return setModuleSource.codes;
}

/** Whether `code` names a Set this client's Definition Index knows. A
 *  Manifest's `setCode` is a HINT frozen at the Game's build from the
 *  server's index, and server and client deploys are not atomic: a code the
 *  client does not know is dropped, and the definition behind it is caught
 *  by {@link setsNeededFor} on the board instead. */
export function isKnownSetCode(code: string): boolean {
    return setModuleSource.codes.includes(code);
}

/** Whether the Set's chunk is resident in this graph. */
export function isSetResident(code: string): boolean {
    return setModuleSource.resident(code) !== undefined;
}

/** The Set a definition id needs resident, or `undefined` when it needs none:
 *  a compiled row (the packed corpus, whole until its own slice), a token, a
 *  face-down sentinel. A twin (an inset spell, a split half, a modal back
 *  face) needs its PARENT's Set — the twin is minted from the parent. */
export function setNeededBy(definitionId: string): string | undefined {
    return handWrittenSetCodeOf(parentIdOfTwin(definitionId) ?? definitionId);
}

/** The Sets among those `definitionIds` need that are NOT resident yet, each
 *  once, in first-seen order. Empty = every definition is answerable now.
 *
 *  `version` is {@link residencyVersion} at the time of the call, passed by a
 *  React caller so that a memoised call (the React Compiler keys a call on its
 *  arguments) is recomputed when a Set becomes resident; the answer itself
 *  reads the residency map, never the number. */
export function setsNeededFor(
    definitionIds: Iterable<string>,
    version: number = residencyVersion()
): string[] {
    void version;
    const needed = new Set<string>();
    for (const id of definitionIds) {
        const code = setNeededBy(id);
        if (code !== undefined && !isSetResident(code)) needed.add(code);
    }
    return [...needed];
}

/** Make every Set in `codes` resident; resolves once all are. Already
 *  resident or in flight Sets cost nothing; a rejection is not memoised. */
export async function installSets(codes: Iterable<string>): Promise<void> {
    const loads: Promise<unknown>[] = [];
    for (const code of new Set(codes))
        loads.push(setModuleSource.install(code));
    await Promise.all(loads);
}

/** WHOLE mode: every Set resident. */
export function installAllSets(): Promise<void> {
    return installSets(setModuleSource.codes);
}
