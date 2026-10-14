// The Constructed Setup flow is a light surface (issue #5584): what loads the
// moment its route module is evaluated holds no card catalogue. Its Import
// deck reaches the catalogue only through `import()`, when the dialog opens;
// the catalogue gate is not mounted for it (`staticData.lightSurface`).
//
// Over the real tree, through the STATIC closure (dynamic edges load on
// demand) and with the browser build's seams (`BROWSER_SEAMS`: `formats.ts`'s
// `./cards` is a catalogue-free stand-in there). The same property over the
// BUILT bundle is `check:bundle`'s `lightSurfaceViolations` (`match-setup`).
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { BROWSER_SEAMS, createImportGraph } from "../lib/import-graph";

const root = path.resolve(__dirname, "../..");
const ROUTE = "src/routes/match-setup.route.tsx";

/** A module whose evaluation loads the card catalogue. */
const isCatalogue = (p: string): boolean =>
    p === "convex/cards/catalogue.ts" ||
    p.startsWith("convex/cards/sets/") ||
    p === "src/lib/catalogueArtifact.ts";

describe("the Setup flow's static closure (issue #5584)", () => {
    const graph = createImportGraph({ root, seams: BROWSER_SEAMS });

    it("loads no card catalogue module", () => {
        const offenders = [
            ...graph.closureOf(ROUTE, { staticOnly: true }),
        ].filter(isCatalogue);
        expect(
            offenders,
            `static closure reaches: ${offenders.join(", ")}`
        ).toEqual([]);
    });

    it("still reaches the catalogue on demand, through the Import deck (not vacuous)", () => {
        expect([...graph.closureOf(ROUTE)].some(isCatalogue)).toBe(true);
    });
});
