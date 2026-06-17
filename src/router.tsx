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
import PrototypeButtonsRoute from "./routes/prototype-buttons.route";
import PrototypeActionButtonsRoute from "./routes/prototype-action-buttons.route";
import PrototypeBoardRoute from "./routes/prototype-board.route";
import PrototypeBoardFullRoute from "./routes/prototype-board-full.route";

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

const gameRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/game",
    component: GameRoute,
    // `?board=next` selects the DOM-only spatial board (PRD #249); absent or
    // any other value falls back to the current board.
    validateSearch: (search: Record<string, unknown>): { board?: "next" } => ({
        board: search.board === "next" ? "next" : undefined,
    }),
});

const prototypeButtonsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/prototype/buttons",
    component: PrototypeButtonsRoute,
});

const prototypeActionButtonsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/prototype/action-buttons",
    component: PrototypeActionButtonsRoute,
});

const prototypeBoardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/prototype/board",
    component: PrototypeBoardRoute,
});

const prototypeBoardFullRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/prototype/board-full",
    component: PrototypeBoardFullRoute,
});

const routeTree = rootRoute.addChildren([
    indexRoute,
    decksCreateRoute,
    deckDetailRoute,
    deckEditRoute,
    gameRoute,
    prototypeButtonsRoute,
    prototypeActionButtonsRoute,
    prototypeBoardRoute,
    prototypeBoardFullRoute,
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
