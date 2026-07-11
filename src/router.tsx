import {
    Outlet,
    RouterProvider,
    createRootRoute,
    createRoute,
    createRouter,
} from "@tanstack/react-router";
import { type FormatId, isFormatId } from "@convex/formats";
import { AuthGate } from "./components/auth/auth-gate";
import BugReportButton from "./components/bug-report/bug-report-button";
import LobbyRoute from "./routes/lobby.route";
import DeckBuilderRoute from "./routes/deck-builder.route";
import DeckDetailRoute from "./routes/deck-detail.route";
import GameRoute from "./routes/game.route";

const rootRoute = createRootRoute({
    component: () => (
        <AuthGate>
            <Outlet />
            <BugReportButton />
        </AuthGate>
    ),
});

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: LobbyRoute,
});

const decksCreateRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/decks/create",
    // Optional `?format=` seed carried from the lobby's format filter, so New
    // Deck opens on the selected format instead of resetting to Freeform. An
    // unknown value is dropped (falls back to the builder's default).
    validateSearch: (search): { format?: FormatId } => {
        const raw = search.format;
        return typeof raw === "string" && isFormatId(raw)
            ? { format: raw }
            : {};
    },
    component: () => <DeckBuilderRoute mode="create" />,
});

const deckDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/decks/$slug",
    component: DeckDetailRoute,
});

const deckEditRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/decks/$slug/edit",
    component: () => <DeckBuilderRoute mode="edit" />,
});

// Admin-only Preset create (PRD #466, ADR 0033, issue #469). Opens the shared
// editor in preset create mode; the first save calls `decks.createPreset`
// (server-gated by `assertIsAdmin`), which derives the slug from the name. The
// lobby exposes the entry point only to admins.
const presetCreateRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/presets/create",
    component: () => <DeckBuilderRoute mode="create" kind="preset" />,
});

// Admin-only Preset edit (PRD #466, ADR 0033). Loads the preset by slug via
// `api.decks.getPreset` and saves through `decks.updatePreset` (server-gated by
// `assertIsAdmin`). The lobby exposes the entry point only to admins.
const presetEditRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/presets/$slug/edit",
    component: () => <DeckBuilderRoute mode="edit" kind="preset" />,
});

const gameRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/game",
    component: GameRoute,
});

const routeTree = rootRoute.addChildren([
    indexRoute,
    decksCreateRoute,
    deckDetailRoute,
    deckEditRoute,
    presetCreateRoute,
    presetEditRoute,
    gameRoute,
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}

export function AppRouter() {
    return <RouterProvider router={router} />;
}
