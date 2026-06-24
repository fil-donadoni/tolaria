import {
    Outlet,
    RouterProvider,
    createRootRoute,
    createRoute,
    createRouter,
} from "@tanstack/react-router";
import { AuthGate } from "./components/auth/auth-gate";
import LobbyRoute from "./routes/lobby.route";
import DeckBuilderRoute from "./routes/deck-builder.route";
import DeckDetailRoute from "./routes/deck-detail.route";
import GameRoute from "./routes/game.route";
import PrototypeStackRoute from "./routes/prototype-stack.route";

const rootRoute = createRootRoute({
    component: () => (
        <AuthGate>
            <Outlet />
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

// PROTOTYPE (throwaway) — battlefield identical-permanent stacking. Delete this
// route + ./routes/prototype-stack.route.tsx once a variant wins.
const prototypeStackRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/prototype/stack",
    validateSearch: (s: Record<string, unknown>): { variant?: string } => ({
        variant: typeof s.variant === "string" ? s.variant : undefined,
    }),
    component: PrototypeStackRoute,
});

const routeTree = rootRoute.addChildren([
    indexRoute,
    decksCreateRoute,
    deckDetailRoute,
    deckEditRoute,
    presetCreateRoute,
    presetEditRoute,
    gameRoute,
    prototypeStackRoute,
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
