// The REAL app shell stays clear of the card catalogue (issue #5379). Every
// file in the shell's closure forces `check:ui` to FULL, so one runtime import
// of a catalogue-reaching module from the shell — the router's `isFormatId`
// from `convex/formats.ts` was one — scoped every card and engine diff to the
// whole walk. These run over the real tree and the real surface table.
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createImportGraph } from "../lib/import-graph";
import { computeUiScope, shellClosure } from "../lib/ui-scope";
import { SURFACES } from "../ui-gate/surfaces";

const root = path.resolve(__dirname, "../..");
const graph = createImportGraph({ root });

/** `convex/cards/**` modules the shell may render: dependency-free display
 *  tables, never the registry or a set. */
const SHELL_CARD_LEAVES = new Set(["convex/cards/setMeta.ts"]);

describe("the real app shell (issue #5379)", () => {
    it("reaches no convex/cards module but its dependency-free leaves", () => {
        const cards = [...shellClosure(graph)].filter(
            (p) => p.startsWith("convex/cards/") && !SHELL_CARD_LEAVES.has(p)
        );
        expect(cards, `shell reaches: ${cards.slice(0, 5).join(", ")}`).toEqual(
            []
        );
    });

    it.each(["convex/cards/sets/lea/red.cards.ts", "convex/gre/combat.ts"])(
        "a diff of only %s selects a non-empty strict subset of surfaces",
        (changed) => {
            const scope = computeUiScope({
                changed: [changed],
                surfaces: SURFACES,
                graph,
            });
            expect(scope.kind).toBe("scoped");
            if (scope.kind !== "scoped") return;
            expect(scope.surfaces.length).toBeGreaterThan(0);
            expect(scope.surfaces.length).toBeLessThan(SURFACES.length);
        }
    );
});
