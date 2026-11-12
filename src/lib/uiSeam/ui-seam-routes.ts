// The `check:ui` seam's client routes (issue #9271, ADR 0179).
//
// DEV ONLY. `router.tsx` calls `buildUiSeamRoutes` behind
// `import.meta.env.DEV`, which a production `vite build` replaces with
// `false`: the call is dead code, this module is unreachable, and nothing of it
// — paths, parameter keys, the echo page — is emitted. Not hidden: absent.
// `bun run check:bundle` proves it on the real build (the namespace marker,
// `UI_SEAM_MARKER`, must occur in no production asset).
//
// Every route here lives under `UI_SEAM_ROUTE_PREFIX` and reads only the
// parameters `pickUiSeamParams` keeps. A lane shortcut that needs a route adds
// it to this list; the server half it calls goes in `convex/uiSeam.ts`.
import {
    createRoute,
    lazyRouteComponent,
    type AnyRoute,
} from "@tanstack/react-router";
import {
    pickUiSeamParams,
    UI_SEAM_ECHO_PATH,
} from "@convex/lib/uiSeamNamespace";

export function buildUiSeamRoutes(rootRoute: AnyRoute): AnyRoute[] {
    const echoRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: UI_SEAM_ECHO_PATH,
        // No card catalogue: the page renders text only.
        staticData: { lightSurface: true },
        validateSearch: (search: Record<string, unknown>) =>
            pickUiSeamParams(search),
        component: lazyRouteComponent(
            () => import("~/routes/ui-seam/ui-seam-echo.route")
        ),
    });
    return [echoRoute as unknown as AnyRoute];
}
