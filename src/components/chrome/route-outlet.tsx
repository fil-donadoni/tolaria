import { lazy, Suspense } from "react";
import { Outlet, useMatches } from "@tanstack/react-router";
import LoadingScreen from "~/components/ui/loading-screen";

// The gate lives in its own chunk: its module imports the catalogue glue, so a
// static import here would put every set module back in the entry (issue
// #4854).
const CatalogueGate = lazy(() => import("~/components/ui/catalogue-gate"));

/**
 * The shell's `<Outlet />`, with the card catalogue gate mounted around it when
 * the matched route can read the registry (ADR 0113 §1/§3, issue #3053,
 * moved here by issue #4854).
 *
 * Gated BY DEFAULT: a route is held back until `getDefinition` is synchronous
 * unless EVERY non-root match declares `staticData: { lightSurface: true }`
 * (`src/router.tsx`). A forgotten flag costs a loading screen; the inverse
 * would cost a card-less board.
 */
export default function RouteOutlet() {
    const needsCatalogue = useMatches({
        select: (matches) =>
            matches.some(
                (match) =>
                    match.routeId !== "__root__" &&
                    match.staticData.lightSurface !== true
            ),
    });
    if (!needsCatalogue) return <Outlet />;
    return (
        <Suspense fallback={<LoadingScreen message="Loading cards..." />}>
            <CatalogueGate>
                <Outlet />
            </CatalogueGate>
        </Suspense>
    );
}
