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
import JoinRoute from "./routes/join.route";
import LimitedEventsRoute from "./routes/limited-events.route";
import LimitedEventDetailRoute from "./routes/limited-event-detail.route";
import LimitedDeckBuilderRoute from "./routes/limited-deck-builder.route";
import PrototypePutBackRoute from "./routes/prototype/put-back/route";

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

// Invite antechamber (`/join/<gameId>`): a shared invite link lands here — the
// visitor sees the host + game format and picks a deck before being credited
// into the match (instead of routing through the lobby).
const joinRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/join/$gameId",
    component: JoinRoute,
});

// Limited Events lobby + detail (PRD #1107, ADR 0054/0055, issue #1110).
const limitedEventsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/limited",
    component: LimitedEventsRoute,
});

const limitedEventDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/limited/$eventId",
    component: LimitedEventDetailRoute,
});

// Pool-scoped deckbuilding (PRD #1107, ADR 0054/0055, issue #1111): a seat's
// constrained builder, entered from the event detail page once the event has
// started and the viewer's own Pool exists.
const limitedDeckBuilderRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/limited/$eventId/build",
    component: LimitedDeckBuilderRoute,
});

// PROTOTYPE (throwaway) — Brainstorm put-back picker. Delete with the route
// folder once the real `putBack` mode + wiring land.
const prototypePutBackRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/prototype/put-back",
    component: PrototypePutBackRoute,
});

const routeTree = rootRoute.addChildren([
    indexRoute,
    decksCreateRoute,
    deckDetailRoute,
    deckEditRoute,
    presetCreateRoute,
    presetEditRoute,
    gameRoute,
    joinRoute,
    limitedEventsRoute,
    limitedEventDetailRoute,
    limitedDeckBuilderRoute,
    prototypePutBackRoute,
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
