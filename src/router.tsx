import {
    createRootRoute,
    createRoute,
    createRouter,
    lazyRouteComponent,
} from "@tanstack/react-router";
import { type FormatId, isFormatId } from "@convex/formats";
import {
    isLimitedEventStatusChip,
    type LimitedEventStatusChip,
} from "~/lib/limitedEventStatus";
import { AuthGate } from "./components/auth/auth-gate";
import BugReportHost from "./components/bug-report/bug-report-host";
import BugReportFloatingButton from "./components/bug-report/bug-report-floating-button";
import { lazyWithProps } from "~/lib/lazyWithProps";
import AppShell from "./components/chrome/app-shell";
import UserPreferencesEffect from "./components/settings/user-preferences-effect";
import NotFoundPage from "./components/ui/not-found-page";
import OfflineBanner from "./components/ui/offline-banner";

// Route components are fetched on first navigation, never bundled into the
// entry (issue #4854): `lazyRouteComponent` for a bare route component,
// `LazyDeckBuilderRoute` (`lazyWithProps`) where the route passes props.
const LazyDeckBuilderRoute = lazyWithProps(
    () => import("./routes/deck-builder.route")
);

// Root: auth first, then the shell, which mounts the shared header on every
// route except the fullscreen board. `AppShell` owns the outlet.
//
// The card catalogue is NOT gated here any more (issue #4854, was ADR 0113
// §1/§3, issue #3053): the login page and the lobby render without the engine
// or the catalogue. The gate is mounted by `RouteOutlet` (inside the shell's
// `<main>`) around every route that does not declare
// `staticData: { lightSurface: true }` — so a new route is GATED by default
// and a surface opts OUT, never in. Nothing under an opted-out route may call
// `getDefinition`/`tryGetDefinition` and rely on an answer.
const rootRoute = createRootRoute({
    component: () => (
        <AuthGate>
            <UserPreferencesEffect />
            <AppShell />
            {/* Issue #3419: the dialog's owner is always mounted; its
                floating trigger stands down on the board, where the
                controller surface hosts the trigger instead. */}
            <BugReportHost />
            <BugReportFloatingButton />
            <OfflineBanner />
        </AuthGate>
    ),
});

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    // The lobby renders before the catalogue is fetched (issue #4854).
    staticData: { lightSurface: true },
    component: lazyRouteComponent(() => import("./routes/lobby.route")),
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
    component: () => <LazyDeckBuilderRoute mode="create" />,
});

const deckDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/decks/$slug",
    component: lazyRouteComponent(() => import("./routes/deck-detail.route")),
});

const deckEditRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/decks/$slug/edit",
    component: () => <LazyDeckBuilderRoute mode="edit" />,
});

// Admin-only Preset create (PRD #466, ADR 0033, issue #469). Opens the shared
// editor in preset create mode; the first save calls `decks.createPreset`
// (server-gated by `assertIsAdmin`), which derives the slug from the name. The
// lobby exposes the entry point only to admins.
const presetCreateRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/presets/create",
    component: () => <LazyDeckBuilderRoute mode="create" kind="preset" />,
});

// Admin-only Preset edit (PRD #466, ADR 0033). Loads the preset by slug via
// `api.decks.getPreset` and saves through `decks.updatePreset` (server-gated by
// `assertIsAdmin`). The lobby exposes the entry point only to admins.
const presetEditRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/presets/$slug/edit",
    component: () => <LazyDeckBuilderRoute mode="edit" kind="preset" />,
});

// Constructed setup flow (PRD #5334, issue #5340): Game mode → Opponent →
// Match Format → decks, as a recap rail beside the active step. Reached from a
// temporary lobby entry until the lobby home replaces the dashboard.
const matchSetupRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/play/constructed",
    component: lazyRouteComponent(() => import("./routes/match-setup.route")),
});

const gameRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/game",
    component: lazyRouteComponent(() => import("./routes/game.route")),
});

// Invite antechamber (`/join/<gameId>`): a shared invite link lands here — the
// visitor sees the host + game format and picks a deck before being credited
// into the match (instead of routing through the lobby).
const joinRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/join/$gameId",
    component: lazyRouteComponent(() => import("./routes/join.route")),
});

// Limited Events lobby + detail (PRD #1107, ADR 0054/0055, issue #1110).
// The merged list (issue #2590): status chips + a "mine" filter, both
// carried in the URL so `/limited?mine=1` is a real, shareable/bookmarkable
// destination — specifically the one `/limited/events` redirects to below.
// An unrecognized `status` (a stale link, a hand-edited URL) is dropped
// rather than kept, mirroring `decksCreateRoute`'s `?format=` guard above.
type LimitedEventsSearch = {
    mine?: true;
    status?: LimitedEventStatusChip;
    /** Fixture-label PREFIX filter (issue #2822): `/limited?label=ui-gate/`
     *  narrows the list to seeded fixture events
     *  (`convex/limitedFixtures.ts`) and nothing else. It exists so
     *  `bun run check:ui`'s two list surfaces measure a row set the LANE
     *  fixes, instead of however many events this deployment's account
     *  happens to be able to see — with no new product chrome: there is no
     *  control that produces this URL, only the walk (and a human debugging
     *  it) types it. A player-created event carries no label, so it can
     *  never match. */
    label?: string;
};

const limitedEventsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/limited",
    validateSearch: (search): LimitedEventsSearch => {
        const out: LimitedEventsSearch = {};
        // Three shapes accepted, not two: TanStack's default `parseSearch`
        // JSON-parses each query-string value, so the literal bookmarkable
        // URL `?mine=1` arrives here as the NUMBER 1, not the string "1" —
        // only `stringifySearch`'s own `?mine=true` output round-trips to
        // the boolean. Dropping the number branch silently turns off the
        // filter for the exact URL this route's doc comment promises.
        if (search.mine === true || search.mine === "1" || search.mine === 1) {
            out.mine = true;
        }
        if (isLimitedEventStatusChip(search.status)) {
            out.status = search.status;
        }
        // Non-empty strings only — TanStack's default `parseSearch`
        // JSON-parses each value, so a numeric-looking label would arrive as a
        // number and an empty `?label=` as `""`; neither is a label, and
        // keeping `""` would filter the list down to nothing rather than
        // leaving it unfiltered.
        if (typeof search.label === "string" && search.label !== "") {
            out.label = search.label;
        }
        return out;
    },
    component: lazyRouteComponent(
        () => import("./routes/limited-events.route")
    ),
});

// Your-events REDIRECT stub (issue #2590; was the your-events page itself,
// issue #2357). `/limited` now absorbs the whole "every event I've ever sat
// at" view behind the `mine` filter, so this route's only job is to send a
// bookmarked/shared `/limited/events` link to `/limited?mine=1`.
//
// The route itself STAYS registered — it is still a STATIC sibling of the
// dynamic `/limited/$eventId` below, and still needs to win that precedence
// (an unregistered path would 404, not redirect). TanStack Router ranks a
// literal path segment above a `$param` one regardless of registration order
// (same static-beats-dynamic precedence already proven by `/decks/create` vs
// `/decks/$slug` above), so `/limited/events` never gets swallowed by the
// `$eventId` matcher — see
// `src/routes/__tests__/router-limited-precedence.test.ts` for the
// assertion, still valid unchanged: it only asserts route MATCHING, not what
// the matched component renders.
// Declared BEFORE the dynamic route here anyway, mirroring the decks pair,
// so the source order documents the precedence instead of relying on it
// silently.
const limitedYourEventsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/limited/events",
    component: lazyRouteComponent(
        () => import("./routes/limited-your-events.route")
    ),
});

const limitedEventDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/limited/$eventId",
    component: lazyRouteComponent(
        () => import("./routes/limited-event-detail.route")
    ),
});

// The Draft Room (issue #2587, PRD #2405 slice 8, ADR 0101 §6): the pick
// screen as its OWN immersive route, out of the event page it used to be
// mounted inside. Its shell mode lives in `SHELL_ROUTE_RULES`
// (`~/lib/shellChrome`), not here — the room owns its chrome.
const limitedDraftRoomRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/limited/$eventId/draft",
    component: lazyRouteComponent(
        () => import("./routes/limited-draft-room.route")
    ),
});

// Pool-scoped deckbuilding (PRD #1107, ADR 0054/0055, issue #1111): a seat's
// constrained builder, entered from the event detail page once the event has
// started and the viewer's own Pool exists.
const limitedDeckBuilderRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/limited/$eventId/build",
    component: lazyRouteComponent(
        () => import("./routes/limited-deck-builder.route")
    ),
});

// Settings (issue #2595, PRD #2405 slice 16/16): density, motion, phase
// stops and the Oracle/Printed preview default, one surface, per user. A
// general-user route (like `/limited`), NOT under `adminRoute`.
const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: lazyRouteComponent(() => import("./routes/settings.route")),
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
    component: lazyRouteComponent(
        () => import("./routes/admin/admin-layout.route")
    ),
});

const adminIndexRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "/",
    component: lazyRouteComponent(
        () => import("./routes/admin/admin-index.route")
    ),
});

// Saved board setups (ADR 0044) — "debug scenarios" as a managed library.
const adminScenariosRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "scenarios",
    component: lazyRouteComponent(
        () => import("./routes/admin/admin-scenarios.route")
    ),
});

const adminBanlistsRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "banlists",
    component: lazyRouteComponent(
        () => import("./routes/admin/admin-banlists.route")
    ),
});

const adminPickRatingsRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "pick-ratings",
    component: lazyRouteComponent(
        () => import("./routes/admin/admin-pick-ratings.route")
    ),
});

const adminCardProfilesRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "card-profiles",
    component: lazyRouteComponent(
        () => import("./routes/admin/admin-card-profiles.route")
    ),
});

// Tester roster (issue #3402, PRD #3397, ADR 0124 §1): who may give a Verdict
// about a Bot decision, granted and revoked here.
const adminTestersRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "testers",
    component: lazyRouteComponent(
        () => import("./routes/admin/admin-testers.route")
    ),
});

// Verdict review (issue #3582, PRD #3574, ADR 0128 §6): contested positions
// rebuilt from their spec and resolved, and any verdict judged cold.
const adminVerdictsRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "verdicts",
    component: lazyRouteComponent(
        () => import("./routes/admin/admin-verdicts.route")
    ),
});

// Bot Findings (issue #4176, PRD #4174, ADR 0141): every card the play Bot is
// measured not to play, seeded from `data/bot-reach-findings.json`.
const adminBotFindingsRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "bot-findings",
    component: lazyRouteComponent(
        () => import("./routes/admin/admin-bot-findings.route")
    ),
});

// Bug-report evidence (issue #2250, following PR #2243's public/private
// split): reporter email, the full game state at the moment they filed, and
// the attachment — previously reachable only via `bunx convex run
// bugReports:getReport … --prod`.
const adminBugReportsRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "bug-reports",
    component: lazyRouteComponent(
        () => import("./routes/admin/admin-bug-reports.route")
    ),
});

// Draft Lab (PRD #1607 slices 5-6, issues #1612/#1613, ADR 0074): a
// client-only developer surface that runs a whole Bot Drafter draft in the
// browser and shows the scorer's per-candidate breakdown. Writes nothing.
const adminDraftLabRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "draft-lab",
    component: lazyRouteComponent(() => import("./routes/draft-lab.route")),
});

// Permanent design-system census (phase 3): the living reference for tokens,
// chrome, and component variants. Unlike the prototype spikes this is kept.
const adminDesignSystemRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "design-system",
    component: lazyRouteComponent(() => import("./routes/design-system.route")),
});

const routeTree = rootRoute.addChildren([
    indexRoute,
    decksCreateRoute,
    deckDetailRoute,
    deckEditRoute,
    presetCreateRoute,
    presetEditRoute,
    matchSetupRoute,
    gameRoute,
    joinRoute,
    limitedEventsRoute,
    limitedYourEventsRoute,
    limitedEventDetailRoute,
    limitedDraftRoomRoute,
    limitedDeckBuilderRoute,
    settingsRoute,
    adminRoute.addChildren([
        adminIndexRoute,
        adminScenariosRoute,
        adminTestersRoute,
        adminVerdictsRoute,
        adminBanlistsRoute,
        adminPickRatingsRoute,
        adminCardProfilesRoute,
        adminBugReportsRoute,
        adminBotFindingsRoute,
        adminDraftLabRoute,
        adminDesignSystemRoute,
    ]),
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
    interface StaticDataRouteOption {
        /** The route renders without the card catalogue hydrated; `RouteOutlet`
         *  mounts no `CatalogueGate` for a match tree made only of these. */
        lightSurface?: boolean;
    }
}
