import type { DefinitionManifestEntry } from "@convex/definitionManifestEntry";
import { isKnownSetCode } from "./definitionShards";

/** One seat's Definition Manifest as `gameReads.getDefinitionManifest`
 *  returns it: `undefined` while loading, `null` for a seat the viewer does
 *  not own or a Game that predates manifests. */
export type ManifestRow =
    | { entries: readonly DefinitionManifestEntry[] }
    | null
    | undefined;

/** The Sets the Manifest rows ask for, each once, in row order — only the
 *  codes THIS client's Definition Index knows (issue #5615). A `setCode` is
 *  a hint frozen at the Game's build from the server's index, and server and
 *  client deploys are not atomic: an unknown code is dropped here, and the
 *  card behind it is caught on the board by `useDefinitionsResident`. */
export function manifestSetCodes(rows: readonly ManifestRow[]): string[] {
    const codes = new Set<string>();
    for (const row of rows) {
        for (const entry of row?.entries ?? []) {
            if (isKnownSetCode(entry.setCode)) codes.add(entry.setCode);
        }
    }
    return [...codes];
}
