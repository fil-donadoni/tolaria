// The REAL app shell stays clear of the card catalogue (issue #5379). Every
// file in the shell's closure forces `check:ui` to FULL, so one runtime import
// of a catalogue-reaching module from the shell — the router's `isFormatId`
// from `convex/formats.ts` was one — scoped every card and engine diff to the
// whole walk. These run over the real tree and the real surface table.
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createImportGraph } from "../lib/import-graph";
import {
    computeUiScope,
    SHELL_DEFERRED_OVERLAYS,
    shellClosure,
} from "../lib/ui-scope";
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

describe("the real design-system census page (issue #6073)", () => {
    const scopeOf = (changed: string) =>
        computeUiScope({ changed: [changed], surfaces: SURFACES, graph });
    const specimenRows = (section: string) =>
        SURFACES.filter((s) => s.specimen?.section === section).map(
            (s) => s.id
        );

    it("a section with no specimen rows selects only the page's own surfaces", () => {
        expect(
            scopeOf("src/routes/design-system/sections-panels-dialogs.tsx")
        ).toEqual({
            kind: "scoped",
            surfaces: ["design-system", "design-system-dialog"],
        });
    });

    it("a specimen section still selects every row it opens", () => {
        const section = "src/routes/design-system/sections-overlays.tsx";
        const rows = specimenRows(section);
        expect(rows.length).toBeGreaterThan(0);
        const scope = scopeOf(section);
        expect(scope.kind).toBe("scoped");
        if (scope.kind !== "scoped") return;
        expect(scope.surfaces).toEqual(expect.arrayContaining(rows));
    });
});

describe("shared UI primitives on the real tree (issue #10230)", () => {
    const scopeOf = (changed: string) =>
        computeUiScope({ changed: [changed], surfaces: SURFACES, graph });

    it.each(SHELL_DEFERRED_OVERLAYS)(
        "the closed-by-default shell overlay %s is opened by a specimen row",
        (overlay) => {
            const rows = SURFACES.filter((s) =>
                (s.mounts ?? []).includes(overlay)
            ).map((s) => s.id);
            expect(rows.length, `no surface mounts ${overlay}`).toBeGreaterThan(
                0
            );
            expect(shellClosure(graph).has(overlay)).toBe(false);
        }
    );

    it("a GameDialog diff walks the surfaces that import it, not every surface", () => {
        const scope = scopeOf("src/components/ui/game-dialog.tsx");
        expect(scope.kind).toBe("scoped");
        if (scope.kind !== "scoped") return;
        expect(scope.surfaces.length).toBeLessThan(SURFACES.length);
        // The overlay the shell defers is still walked, through its specimen.
        expect(scope.surfaces).toContain("dlg-bug-report");
        expect(scope.surfaces).toContain("dlg-sideboarding");
    });

    it("the overlay's opener stays in the shell and still forces full", () => {
        expect(
            scopeOf("src/components/bug-report/bug-report-host.tsx").kind
        ).toBe("full");
    });
});
