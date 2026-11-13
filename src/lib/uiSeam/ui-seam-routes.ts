// The `check:ui` seam's client routes (issue #9271, ADR 0180).
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
    UI_SEAM_LIMITED_DECK_PATH,
    UI_SEAM_LIMITED_SCREEN_PATH,
    UI_SEAM_SIDEBOARDING_PATH,
    UI_SEAM_POSITION_PATH,
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
    // Issue #9272: a declared position loaded into the lane's own solo game,
    // then the board. The page itself renders one status line; the board it
    // routes to carries its own catalogue gate.
    const positionRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: UI_SEAM_POSITION_PATH,
        staticData: { lightSurface: true },
        validateSearch: (search: Record<string, unknown>) =>
            pickUiSeamParams(search),
        component: lazyRouteComponent(
            () => import("~/routes/ui-seam/ui-seam-position.route")
        ),
    });
    // Issue #9272: a Limited fixture seat saved as a deck, then the Limited
    // Deck Archive.
    const limitedDeckRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: UI_SEAM_LIMITED_DECK_PATH,
        staticData: { lightSurface: true },
        validateSearch: (search: Record<string, unknown>) =>
            pickUiSeamParams(search),
        component: lazyRouteComponent(
            () => import("~/routes/ui-seam/ui-seam-limited-deck.route")
        ),
    });
    // Issue #9560: a Limited fixture's screen (event, Draft Room, pool
    // builder) in one navigation.
    const limitedScreenRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: UI_SEAM_LIMITED_SCREEN_PATH,
        staticData: { lightSurface: true },
        validateSearch: (search: Record<string, unknown>) =>
            pickUiSeamParams(search),
        component: lazyRouteComponent(
            () => import("~/routes/ui-seam/ui-seam-limited-screen.route")
        ),
    });
    // Issue #9560: the lane's solo Match forced to the Bo3 sideboarding gate,
    // then the board.
    const sideboardingRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: UI_SEAM_SIDEBOARDING_PATH,
        staticData: { lightSurface: true },
        validateSearch: (search: Record<string, unknown>) =>
            pickUiSeamParams(search),
        component: lazyRouteComponent(
            () => import("~/routes/ui-seam/ui-seam-sideboarding.route")
        ),
    });
    return [
        echoRoute as unknown as AnyRoute,
        positionRoute as unknown as AnyRoute,
        limitedDeckRoute as unknown as AnyRoute,
        limitedScreenRoute as unknown as AnyRoute,
        sideboardingRoute as unknown as AnyRoute,
    ];
}
