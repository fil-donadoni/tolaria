import {
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
import LimitedYourEventsRoute from "./routes/limited-your-events.route";
import LimitedEventDetailRoute from "./routes/limited-event-detail.route";
import LimitedDeckBuilderRoute from "./routes/limited-deck-builder.route";
import DesignSystemRoute from "./routes/design-system.route";
import DraftLabRoute from "./routes/draft-lab.route";
import AdminLayoutRoute from "./routes/admin/admin-layout.route";
import AdminIndexRoute from "./routes/admin/admin-index.route";
import AdminScenariosRoute from "./routes/admin/admin-scenarios.route";
import AdminBanlistsRoute from "./routes/admin/admin-banlists.route";
import AdminPickRatingsRoute from "./routes/admin/admin-pick-ratings.route";
import AdminCardProfilesRoute from "./routes/admin/admin-card-profiles.route";
import AdminBugReportsRoute from "./routes/admin/admin-bug-reports.route";
import AppShell from "./components/chrome/app-shell";
import NotFoundPage from "./components/ui/not-found-page";
import PrototypeTouchRoute from "./routes/prototype-touch.route";

// Root: auth first, then the shell, which mounts the shared header on every
// route except the fullscreen board. `AppShell` owns the `Outlet`.
const rootRoute = createRootRoute({
    component: () => (
        <AuthGate>
            <AppShell />
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

// Your-events page (issue #2357) — a STATIC sibling of the dynamic
// `/limited/$eventId` below. TanStack Router ranks a literal path segment
// above a `$param` one regardless of registration order (same static-beats-
// dynamic precedence already proven by `/decks/create` vs `/decks/$slug`
// above), so `/limited/events` never gets swallowed by the `$eventId`
// matcher — see `src/routes/__tests__/router-limited-precedence.test.ts`
// for the assertion.
// Declared BEFORE the dynamic route here anyway, mirroring the decks pair,
// so the source order documents the precedence instead of relying on it
// silently.
const limitedYourEventsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/limited/events",
    component: LimitedYourEventsRoute,
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

// ─────────────────────────────────────────────────────────────────────────
// Admin section. ONE layout route gates the whole subtree (`AdminRouteGate`
// inside `AdminLayoutRoute`): a non-admin gets the same 404 an unknown path
// produces, and a new admin page inherits the gate by being added here. The
// pages themselves are the curation/developer surfaces that used to be either
// buried at the bottom of the Lobby (banlists, pick ratings, card profiles),
// reachable only from inside a game (scenarios), or on an unlisted top-level
// path anyone could guess (`/draft-lab`, `/design-system`).
// ─────────────────────────────────────────────────────────────────────────
const adminRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin",
    component: AdminLayoutRoute,
});

const adminIndexRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "/",
    component: AdminIndexRoute,
});

// Saved board setups (ADR 0044) — "debug scenarios" as a managed library.
const adminScenariosRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "scenarios",
    component: AdminScenariosRoute,
});

const adminBanlistsRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "banlists",
    component: AdminBanlistsRoute,
});

const adminPickRatingsRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "pick-ratings",
    component: AdminPickRatingsRoute,
});

const adminCardProfilesRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "card-profiles",
    component: AdminCardProfilesRoute,
});

// Bug-report evidence (issue #2250, following PR #2243's public/private
// split): reporter email, the full game state at the moment they filed, and
// the attachment — previously reachable only via `bunx convex run
// bugReports:getReport … --prod`.
const adminBugReportsRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "bug-reports",
    component: AdminBugReportsRoute,
});

// Draft Lab (PRD #1607 slices 5-6, issues #1612/#1613, ADR 0074): a
// client-only developer surface that runs a whole Bot Drafter draft in the
// browser and shows the scorer's per-candidate breakdown. Writes nothing.
const adminDraftLabRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "draft-lab",
    component: DraftLabRoute,
});

// Permanent design-system census (phase 3): the living reference for tokens,
// chrome, and component variants. Unlike /prototype/* spikes this is kept.
const adminDesignSystemRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "design-system",
    component: DesignSystemRoute,
});

// PROTOTYPE — throwaway route (delete with `src/components/prototype/`).
// Touch-gesture / snap / peek / chamfer prototypes for PRD #2405 (#G1).
const prototypeTouchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/prototype/touch",
    validateSearch: (
        search
    ): { variant?: string; surface?: "builder" | "draft" | "prompt" } => {
        const v = search.variant;
        const sf = search.surface;
        return {
            ...(typeof v === "string" ? { variant: v } : {}),
            ...(sf === "builder" || sf === "draft" || sf === "prompt"
                ? { surface: sf }
                : {}),
        };
    },
    component: PrototypeTouchRoute,
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
    limitedYourEventsRoute,
    limitedEventDetailRoute,
    limitedDeckBuilderRoute,
    adminRoute.addChildren([
        adminIndexRoute,
        adminScenariosRoute,
        adminBanlistsRoute,
        adminPickRatingsRoute,
        adminCardProfilesRoute,
        adminBugReportsRoute,
        adminDraftLabRoute,
        adminDesignSystemRoute,
    ]),
    prototypeTouchRoute,
]);

// One 404 for the whole app. TanStack Router's built-in fallback is a bare
// "Not Found" string with no chrome; `NotFoundPage` is the real page, and it
// is the SAME component the admin gate renders for a non-admin — that is what
// makes an admin surface indistinguishable from a path that doesn't exist
// (see `admin-route-gate.tsx`).
//
// Exported (not just used by `AppRouter` below) so a test can call
// `router.getMatchedRoutes(path)` directly — issue #2357's static-vs-dynamic
// precedence check (`/limited/events` vs `/limited/$eventId`) needs the REAL
// route tree, not a hand-built replica that could silently drift from it.
export const router = createRouter({
    routeTree,
    defaultNotFoundComponent: NotFoundPage,
});

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}
