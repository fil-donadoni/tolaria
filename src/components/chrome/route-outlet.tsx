import { Suspense } from "react";
import { Outlet, useMatches } from "@tanstack/react-router";
import LoadingScreen from "~/components/ui/loading-screen";
// The gate lives in its own chunk: its module imports the catalogue glue, so a
// static import here would put every set module back in the entry (issue
// #4854). The frame loads it (`~/lib/catalogueGateLoader`) without suspending
// once it is in memory (issue #5584).
import CatalogueGateFrame from "./catalogue-gate-frame";
import { routeCatalogueNeed } from "~/lib/routeCatalogueNeed";

/**
 * The shell's `<Outlet />`, with the card catalogue gate mounted around it when
 * the matched route can read the registry (ADR 0113 §1/§3, issue #3053,
 * moved here by issue #4854).
 *
 * Gated BY DEFAULT: a route is held back until `getDefinition` is synchronous
 * unless EVERY non-root match declares `staticData: { lightSurface: true }`
 * (`src/router.tsx`). A forgotten flag costs a loading screen; the inverse
 * would cost a card-less board. A route declaring `catalogue: "game"` gets
 * the packed corpus only and loads the Sets of its Definition Manifest itself
 * (issue #5615) — every other gated route gets the whole catalogue.
 */
export default function RouteOutlet() {
    const need = useMatches({ select: routeCatalogueNeed });
    if (need === "none") return <Outlet />;
    return (
        <Suspense fallback={<LoadingScreen message="Loading cards..." />}>
            {/* Keyed by mode: a gate that earned `ready` for the game route
                must not carry it onto a whole-catalogue route (the frame
                renders the same element shape across navigations). */}
            <CatalogueGateFrame key={need} mode={need}>
                <Outlet />
            </CatalogueGateFrame>
        </Suspense>
    );
}
