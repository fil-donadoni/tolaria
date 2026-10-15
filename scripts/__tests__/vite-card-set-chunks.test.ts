import { describe, it, expect } from "vitest";
import {
    cardSetChunkName,
    owningSet,
    setCodeOf,
    type ImporterGraph,
} from "../lib/vite-card-set-chunks";

/**
 * The per-Set chunk naming (issue #5615): a Set's modules and the helpers
 * only that Set reaches go to `card-set-<code>`; anything the app or a second
 * Set reaches is left to the bundler's shared chunks. Pinned on a hand-made
 * importer graph, since the real one exists only inside `vite build` (where
 * `check:bundle` measures the effect: no Set in two chunks, no static cycle).
 */

const SETS = "/repo/convex/cards/sets";
const ltrBlack = `${SETS}/ltr/black.cards.ts`;
const ltrRed = `${SETS}/ltr/red.cards.ts`;
const ltrIndex = `${SETS}/ltr/index.cards.ts`;
const drkBlue = `${SETS}/drk/blue.cards.ts`;
const amass = "/repo/convex/cards/abilities/amass.ts"; // ltr only
const amassCore = "/repo/convex/cards/abilities/amassCore.ts"; // via amass
const equipment = "/repo/convex/cards/abilities/equipment.ts"; // two Sets
const defineCard = "/repo/convex/cards/defineCard.ts"; // the app too
const loader = "/repo/src/lib/catalogue/set-chunk-loader.ts";
const lazyHelper = "/repo/convex/gre/lazyHelper.ts"; // ltr, static and import()ed
const cyclicA = "/repo/convex/gre/cyclicA.ts";
const cyclicB = "/repo/convex/gre/cyclicB.ts";

/** importers of each module (static), and who imports it dynamically. */
const graph = (
    edges: Record<string, { importers?: string[]; dynamic?: string[] }>
): ImporterGraph => ({
    getModuleInfo: (id) =>
        id in edges
            ? ({
                  importers: edges[id]!.importers ?? [],
                  dynamicImporters: edges[id]!.dynamic ?? [],
              } as never)
            : null,
});

const g = graph({
    [ltrIndex]: { dynamic: [loader] },
    [ltrBlack]: { importers: [ltrIndex] },
    [ltrRed]: { importers: [ltrIndex] },
    [drkBlue]: { importers: [`${SETS}/drk/index.cards.ts`] },
    [amass]: { importers: [ltrBlack, ltrRed] },
    [amassCore]: { importers: [amass] },
    [equipment]: { importers: [ltrBlack, drkBlue] },
    [defineCard]: { importers: [ltrBlack, "/repo/src/lib/x.ts"] },
    [lazyHelper]: { importers: [ltrRed], dynamic: [ltrBlack] },
    [cyclicA]: { importers: [cyclicB, ltrRed] },
    [cyclicB]: { importers: [cyclicA] },
});

describe("setCodeOf", () => {
    it("reads the Set code off a Set module's id, and nothing off another", () => {
        expect(setCodeOf(ltrBlack)).toBe("ltr");
        expect(
            setCodeOf(`C:\\repo\\convex\\cards\\sets\\5dn\\index.cards.ts`)
        ).toBe("5dn");
        expect(setCodeOf(amass)).toBeUndefined();
    });
});

describe("owningSet", () => {
    it("a Set module is its Set's, whatever imports it", () => {
        expect(owningSet(ltrIndex, g)).toBe("ltr");
        expect(owningSet(drkBlue, g)).toBe("drk");
    });

    it("a helper only one Set reaches, directly or through another helper, is that Set's", () => {
        expect(owningSet(amass, g)).toBe("ltr");
        expect(owningSet(amassCore, g)).toBe("ltr");
    });

    it("a helper two Sets reach is nobody's", () => {
        expect(owningSet(equipment, g)).toBeUndefined();
    });

    it("a module a Set also reaches through import() is nobody's — it is its own lazy boundary", () => {
        expect(owningSet(lazyHelper, g)).toBeUndefined();
    });

    it("a module the app reaches is nobody's", () => {
        expect(owningSet(defineCard, g)).toBeUndefined();
    });

    it("an importer cycle outside the Sets settles as nobody's, never loops", () => {
        expect(owningSet(cyclicA, g)).toBeUndefined();
        expect(owningSet(cyclicB, g)).toBeUndefined();
    });

    it("a module nobody imports, or one the bundler cannot describe, is nobody's", () => {
        expect(
            owningSet(
                "/repo/convex/entry.ts",
                graph({ "/repo/convex/entry.ts": {} })
            )
        ).toBeUndefined();
        expect(owningSet("/repo/convex/unknown.ts", g)).toBeUndefined();
    });
});

describe("cardSetChunkName", () => {
    it("names a Set chunk for what a Set owns, and nothing for the rest", () => {
        const memos = new WeakMap();
        expect(cardSetChunkName(ltrBlack, g, memos)).toBe("card-set-ltr");
        expect(cardSetChunkName(amass, g, memos)).toBe("card-set-ltr");
        expect(cardSetChunkName(equipment, g, memos)).toBeUndefined();
        expect(cardSetChunkName(defineCard, g, memos)).toBeUndefined();
    });
});
