// The Convex validator of one Definition Manifest entry (issue #5614) — the
// storage shape of `gameDefinitionManifests.entries` and the `returns` shape
// of `gameReads.getDefinitionManifest`.
//
// A LEAF module on purpose, like `deckLayoutStorage.ts`: `convex/schema.ts`
// and the card-free `gameReads.ts` both need it, and neither may reach the
// catalogue `convex/definitionManifest.ts` derives entries from. One authority
// per shape: a field added to the table but not to a hand-kept `returns` copy
// fails the query at runtime, invisibly to `tsc`.
import { v, type Infer } from "convex/values";

/** A Card Definition a seat's client can need in a Game, and the Set code
 *  that keys the client shard holding it. */
export const definitionManifestEntryValidator = v.object({
    definitionId: v.string(),
    setCode: v.string(),
});

export type DefinitionManifestEntry = Infer<
    typeof definitionManifestEntryValidator
>;
