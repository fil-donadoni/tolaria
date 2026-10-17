// The setup flow's strict Import deck, loaded ON DEMAND (issue #5584).
//
// `/play/constructed` is a light surface: it renders without the card
// catalogue, so the parser — which resolves names through the catalogue — and
// the catalogue itself must not be in its static graph. The Import deck dialog
// calls this when it opens: one dynamic import of the parser, and the
// compiled Definition Index — every card's NAME, no definition (issue #5616).
// The pasted deck's own shards load at submit (`makeDecklistResident`), never
// the whole catalogue. Importing `./catalogueArtifact` also installs the
// catalogue's deck-card resolver that `validateDeck` defaults to in the
// browser.
import type * as StrictImport from "./matchSetupDeckImport";

export type StrictImportModule = typeof StrictImport;

let loaded: StrictImportModule | null = null;

/** The parser, once a load has completed — what a reopened dialog starts
 *  from instead of showing "Loading cards…" again for a tick. */
export function loadedStrictImport(): StrictImportModule | null {
    return loaded;
}

export async function loadStrictImport(): Promise<StrictImportModule> {
    const [strictImport] = await Promise.all([
        import("./matchSetupDeckImport"),
        import("./catalogueArtifact").then(() =>
            import("./catalogue/compiled-shards").then((m) =>
                m.installCompiledIndex()
            )
        ),
    ]);
    loaded = strictImport;
    return strictImport;
}
