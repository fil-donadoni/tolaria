// One census-page load per viewport (issue #4687): the reuse decision is
// fail-closed — a specimen layer left open by the previous row forces a fresh
// navigation, so it cannot leak into this row's measurement — and every row
// that opens a layer declares the cleanup that closes it.
import { describe, expect, it } from "vitest";
import {
    CENSUS_PATH,
    censusPageReuse,
    specimenLayerSelector,
} from "../ui-gate/census-page";
import { SURFACES } from "../ui-gate/surfaces";

const BASE = "http://127.0.0.1:5173";

describe("censusPageReuse — when the previous row's page may take this opener", () => {
    it("reuses the census page when it is loaded and no specimen layer is visible", () => {
        expect(
            censusPageReuse({
                url: `${BASE}${CENSUS_PATH}`,
                baseUrl: BASE,
                openLayers: 0,
            })
        ).toEqual({ reuse: true });
    });

    it("ignores a trailing slash, a query and a hash on the page's url", () => {
        for (const url of [
            `${BASE}${CENSUS_PATH}/`,
            `${BASE}${CENSUS_PATH}?x=1`,
            `${BASE}${CENSUS_PATH}#cast-pickers`,
        ]) {
            expect(
                censusPageReuse({ url, baseUrl: BASE, openLayers: 0 })
            ).toEqual({ reuse: true });
        }
    });

    it("navigates when a specimen layer is still open — a leak-in-waiting", () => {
        const d = censusPageReuse({
            url: `${BASE}${CENSUS_PATH}`,
            baseUrl: BASE,
            openLayers: 1,
        });
        expect(d.reuse).toBe(false);
        expect(d).toMatchObject({
            reason: "1 specimen layer(s) still open from the previous row",
        });
    });

    it("navigates from any other page, the first row of the viewport included", () => {
        for (const url of ["about:blank", `${BASE}/`, `${BASE}/admin`, ""]) {
            const d = censusPageReuse({ url, baseUrl: BASE, openLayers: 0 });
            expect(d.reuse, url).toBe(false);
        }
    });

    it("navigates when the layer count could not be read", () => {
        expect(
            censusPageReuse({
                url: `${BASE}${CENSUS_PATH}`,
                baseUrl: BASE,
                openLayers: -1,
            }).reuse
        ).toBe(false);
    });
});

describe("specimenLayerSelector", () => {
    it("unions the declared layers with the dialog role, each once", () => {
        expect(
            specimenLayerSelector([
                "[role=dialog]",
                "[data-action-sheet]",
                "[role=dialog]",
                '[data-slot="dialog-content"]',
            ])
        ).toBe(
            '[role=dialog], [data-action-sheet], [data-slot="dialog-content"]'
        );
    });
});

describe("every census row that opens a layer declares the cleanup that closes it", () => {
    const rows = SURFACES.filter(
        (s) =>
            s.id === "design-system-dialog" ||
            s.id.startsWith("dlg-") ||
            s.id.startsWith("pick-")
    );

    it("finds the census rows", () => {
        expect(rows.length).toBeGreaterThan(20);
    });

    it.each(rows.map((s) => [s.id, s] as const))(
        "%s declares cleanup",
        (_id, surface) => {
            expect(typeof surface.cleanup).toBe("function");
        }
    );
});
