// The setup flow's strict Import deck, loaded ON DEMAND (issue #5584).
//
// `/play/constructed` is a light surface: it renders without the card
// catalogue, so the parser — which resolves names through the catalogue — and
// the catalogue itself must not be in its static graph. The Import deck dialog
// calls this when it opens: one dynamic import of the parser, and
// `hydrateCatalogue()`, the memoised fetch the catalogue gate awaits too (so
// whichever runs first pays it, once per document). Importing
// `./catalogueArtifact` also installs the catalogue's deck-card resolver that
// `validateDeck` defaults to in the browser.
import type * as StrictImport from "./matchSetupDeckImport";

export type StrictImportModule = typeof StrictImport;

export async function loadStrictImport(): Promise<StrictImportModule> {
    const [strictImport] = await Promise.all([
        import("./matchSetupDeckImport"),
        import("./catalogueArtifact").then((m) => m.hydrateCatalogue()),
    ]);
    return strictImport;
}
