// Every route `check:ui` walks raises the Settled Screen's ready marker once
// its data has arrived (issue #3644). The settle predicate waits for
// `[data-surface-ready]` before anything is measured, so a walked route that
// stops rendering `SurfaceReadyMarker` does not fail loudly in the browser — it
// burns the settle timeout on every cell and reads as an Infra Verdict. This
// reds offline instead.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createImportGraph } from "../lib/import-graph";
import { SURFACE_READY_ATTRIBUTE } from "../ui-gate/settle";
import { SURFACES } from "../ui-gate/surfaces";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MARKER_MODULE = "src/components/ui/surface-ready-marker.tsx";
const RENDERS_MARKER = /<SurfaceReadyMarker\b/;

/**
 * Entry modules that render no screen of their own, with the reason. A
 * surface lists every route its walk passes through (`Surface.entries`), and
 * these two are passed through, never landed on.
 */
const RENDERS_NO_SCREEN: Record<string, string> = {
    "src/routes/admin/admin-layout.route.tsx":
        "layout route: renders its child route through <Outlet />, and the child carries the marker",
    "src/routes/limited-your-events.route.tsx":
        "redirect stub: navigates to /limited on mount, whose page carries the marker",
};

/** The signed-out surfaces declare the lobby route, but what renders there is
 *  `<AuthGate>`'s form (see `Surface.entries`). */
const SIGNED_OUT_SCREEN = "src/components/auth/auth-form.tsx";

function source(repoPath: string): string {
    return fs.readFileSync(path.join(REPO_ROOT, repoPath), "utf8");
}

const graph = createImportGraph({ root: REPO_ROOT });
const walkedRoutes = [...new Set(SURFACES.flatMap((s) => s.entries))].sort();

describe("check:ui walked routes raise the Settled Screen's ready marker", () => {
    it("the marker component renders the attribute the settle predicate waits for", () => {
        expect(source(MARKER_MODULE)).toContain(`${SURFACE_READY_ATTRIBUTE}=`);
    });

    it.each(walkedRoutes.filter((r) => !(r in RENDERS_NO_SCREEN)))(
        "%s renders SurfaceReadyMarker, itself or through a module it imports directly",
        (route) => {
            const carriers = [route, ...graph.importsOf(route)].filter(
                (m) => m !== MARKER_MODULE && RENDERS_MARKER.test(source(m))
            );
            expect(
                carriers,
                `${route} is walked by check:ui but neither it nor a direct import renders <SurfaceReadyMarker /> in its loaded branch`
            ).not.toEqual([]);
        }
    );

    it("every route exempted as rendering no screen is still a walked route", () => {
        for (const route of Object.keys(RENDERS_NO_SCREEN)) {
            expect(
                walkedRoutes,
                `${route} is no longer walked — drop its exemption`
            ).toContain(route);
        }
    });

    it("the signed-out form renders the marker, since the signed-out surfaces never mount their route", () => {
        expect(SURFACES.some((s) => s.preAuth)).toBe(true);
        expect(source(SIGNED_OUT_SCREEN)).toMatch(RENDERS_MARKER);
    });
});
