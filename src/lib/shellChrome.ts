// Which SHELL MODE a route wears (issue #2582, PRD #2405, ADR 0101 §"AppShell").
//
// This file used to answer one boolean — `shellShowsHeader(pathname)` — with a
// single `/game` prefix exception. Design system v3 needs two modes instead:
//
//  - **Browse** (lobby, deck detail, the Limited flow, admin): the app's
//    navigation is present. On desktop/tablet that is a 56px top bar; on a
//    landscape phone a 40px compact bar; on a portrait phone the top bar is
//    dropped entirely and the destinations move to a bottom nav under the
//    thumb (with safe-area padding).
//  - **Immersive** (both deck builders, the board): no persistent navigation
//    at all. A 44px contextual bar carries an explicit Exit and an overflow
//    menu — except on the board, which renders its OWN chrome (pause menu, dev
//    rail) and therefore gets no shell bar whatsoever (`ownChrome`).
//
// WHY A REGISTRY AND NOT A PREFIX RULE. A prefix heuristic fails OPEN: add
// `/decks/$slug/stats` tomorrow and it silently inherits whatever `/decks`
// resolved to, with nothing red anywhere. Every route is declared here by its
// ROUTER PATH PATTERN, and `shellChrome.test.ts` cross-checks the registry
// against the paths it reads out of `router.tsx` — so a new route that nobody
// classified reds the gate instead of guessing. That check is the fail-closed
// half; the runtime default below (`browse`) is only what an UNREGISTERED path
// gets, i.e. the 404 page, which should certainly keep its navigation.
//
// `/prototype/*` (ADR 0101's fourth immersive family) has NO route on `main`
// — the spikes live on the `prototype/touch-gestures` branch. It is absent
// here on purpose rather than pre-declared: the census test asserts the
// registry and `router.tsx` name EXACTLY the same set, so the day a prototype
// route is registered the gate goes red and someone classifies it, which is
// strictly better than a speculative row that silently rots.
//
// The heights these modes cost are NOT here — they are arithmetic, and they
// live with the rest of the shell's box chain in `shellLayout.ts`
// (`shellBands`). Splitting them was deliberate: issues #2056/#2274 were both
// caused by a height that no single module owned.

/** The two shell modes of ADR 0101. */
export type ShellMode = "browse" | "immersive";

/**
 * A piece of in-flight work the shell's return banner can point back at.
 *
 * The banner offers exactly ONE verb ("go back to it"), which is what makes it
 * chrome rather than a surface. A route that already offers the SAME return in
 * full — resume plus whatever else that session needs — owns the affordance,
 * and the shell must not stack a second, weaker copy of it on top: see
 * `ShellRouteRule.ownsReturn`.
 */
export type ReturnAffordance = "game" | "event";

/** What the shell renders around a route. */
export interface ShellRouteChrome {
    mode: ShellMode;
    /**
     * The route draws its own chrome, so the shell adds NO band of its own —
     * `<main>` is the whole viewport. True only for the board (`/game`): it
     * has a pause menu and a dev rail, and a contextual bar would duplicate an
     * exit it already offers while taking height from the battlefield.
     */
    ownChrome: boolean;
    /** Title for the immersive contextual bar (`null` in Browse mode). */
    title: string | null;
    /**
     * Where the contextual bar's Exit goes, with route params already
     * substituted from the concrete pathname (`null` in Browse mode / when the
     * route owns its chrome).
     */
    exitTo: string | null;
}

/** One row of the route census — the unit `shellChrome.test.ts` checks. */
export interface ShellRouteRule {
    /** The route path pattern exactly as `router.tsx` composes it. */
    pattern: string;
    mode: ShellMode;
    /** See `ShellRouteChrome.ownChrome`. Absent means `false`. */
    ownChrome?: true;
    /** Contextual-bar title. Required for an immersive route with a bar. */
    title?: string;
    /**
     * Exit target as a pattern. `$param` segments are substituted from the
     * matched pathname, so `/limited/$eventId` under `/limited/$eventId/build`
     * exits back to the event the seat belongs to.
     */
    exitTo?: string;
    /**
     * Return affordances this route ALREADY offers in full, so the shell's
     * one-verb band would be a second copy of the same thing.
     *
     * OWNERSHIP, NOT A ROUTE CHECK. The shell banner is a POINTER to work
     * happening somewhere else; a surface that manages that work itself is not
     * "somewhere else". The lobby's `ActiveGameNotice` (#155) resumes a game
     * AND leaves/concedes it, and offers the per-seat resume a manual table
     * needs; the lobby's `DashboardLimitedBox` (#2357) lists every live event
     * with its own re-entry. Both are strictly richer than the band, so the
     * band stands down there rather than the surface losing its destructive
     * half. Declaring it here — beside `mode` and `ownChrome`, in the census
     * the route-set test already pins — is what keeps it from decaying into a
     * hardcoded `pathname === "/"` in `shellShowsReturnBanner`: a new route
     * that duplicates a return says so in its own row.
     *
     * An `"event"` claim on a pattern containing `$eventId` is scoped to THAT
     * event — `/limited/e2` still points you back at the running `e1`.
     */
    ownsReturn?: readonly ReturnAffordance[];
    /** Why this route is classified the way it is — read by the census test. */
    why: string;
}

/**
 * Every route in `router.tsx`, classified. Order is irrelevant: matching is
 * exact per pattern, never longest-prefix.
 *
 * The pairs that make a prefix rule unusable are deliberately adjacent below:
 * `/decks/$slug` browses while `/decks/$slug/edit` is immersive, and
 * `/limited/$eventId` browses while `/limited/$eventId/build` is immersive.
 */
export const SHELL_ROUTE_RULES: readonly ShellRouteRule[] = [
    {
        pattern: "/",
        mode: "browse",
        ownsReturn: ["game", "event"],
        why: "Lobby — the app's primary destination; nav is the point of it. It also OWNS both returns: `ActiveGameNotice` (resume + leave/concede) and `DashboardLimitedBox` (live events with re-entry).",
    },
    {
        pattern: "/decks/create",
        mode: "immersive",
        title: "New deck",
        exitTo: "/",
        why: "Mounts DeckBuilderRoute — a deck builder, immersive per ADR 0101.",
    },
    {
        pattern: "/decks/$slug",
        mode: "browse",
        why: "Deck DETAIL is a read page (list, curve, legality), not an editor.",
    },
    {
        pattern: "/decks/$slug/edit",
        mode: "immersive",
        title: "Edit deck",
        exitTo: "/decks/$slug",
        why: "The deck builder again — one segment deeper than the browse page above.",
    },
    {
        pattern: "/presets/create",
        mode: "immersive",
        title: "New preset",
        exitTo: "/",
        why: "The same DeckBuilderRoute in preset mode (ADR 0033).",
    },
    {
        pattern: "/presets/$slug/edit",
        mode: "immersive",
        title: "Edit preset",
        exitTo: "/",
        why: "The same DeckBuilderRoute in preset mode; presets have no detail page to exit to.",
    },
    {
        pattern: "/game",
        mode: "immersive",
        ownChrome: true,
        why: "The board carries its own chrome (pause menu, dev rail) — a shell bar would duplicate its exit and cost battlefield height.",
    },
    {
        pattern: "/join/$gameId",
        mode: "browse",
        why: "Invite antechamber — a lobby-side page reached from a shared link.",
    },
    {
        pattern: "/limited",
        mode: "browse",
        why: "Limited events list — a section index, browsed between like the lobby.",
    },
    {
        pattern: "/limited/events",
        mode: "browse",
        why: "Your-events list (issue #2357) — a static sibling of the dynamic route below.",
    },
    {
        pattern: "/limited/$eventId",
        mode: "browse",
        ownsReturn: ["event"],
        why: "Event detail / antechamber — and the event's own page, so it owns that event's return. The immersive Draft Room is its OWN route in issue #2587, not this one.",
    },
    {
        pattern: "/limited/$eventId/build",
        mode: "immersive",
        title: "Build your deck",
        exitTo: "/limited/$eventId",
        ownsReturn: ["event"],
        why: "The pool-scoped deck builder — immersive like the constructed one, and inside the event it would point back at.",
    },
    {
        pattern: "/admin",
        mode: "browse",
        why: "Admin index — a curation surface, navigated between like any other section.",
    },
    {
        pattern: "/admin/scenarios",
        mode: "browse",
        why: "Admin page — the saved-board-setup library (ADR 0044), browsed and edited in place.",
    },
    {
        pattern: "/admin/banlists",
        mode: "browse",
        why: "Admin page — the banlist editor, reached and left through the admin nav.",
    },
    {
        pattern: "/admin/pick-ratings",
        mode: "browse",
        why: "Admin page — the pick-rating editor, reached and left through the admin nav.",
    },
    {
        pattern: "/admin/card-profiles",
        mode: "browse",
        why: "Admin page — the card-profile editor, reached and left through the admin nav.",
    },
    {
        pattern: "/admin/bug-reports",
        mode: "browse",
        why: "Admin page — bug-report evidence, reached and left through the admin nav.",
    },
    {
        pattern: "/admin/draft-lab",
        mode: "browse",
        why: "Developer surface (ADR 0074) — reached and left through the admin nav.",
    },
    {
        pattern: "/admin/design-system",
        mode: "browse",
        why: "The living token/component census — browsed, not edited.",
    },
] as const;

/** `/foo/bar/` and `/foo/bar` are the same route; `/` stays `/`. */
function segmentsOf(path: string): string[] {
    const trimmed = path.replace(/\/+$/, "");
    if (trimmed === "") return [];
    return trimmed.split("/").slice(1);
}

function matches(patternSegments: string[], pathSegments: string[]): boolean {
    if (patternSegments.length !== pathSegments.length) return false;
    return patternSegments.every(
        (seg, i) =>
            (seg.startsWith("$") && pathSegments[i].length > 0) ||
            seg === pathSegments[i]
    );
}

/** The rule `pathname` resolves to, with the segments both halves need. */
interface ShellRouteMatch {
    rule: ShellRouteRule;
    patternSegments: string[];
    pathSegments: string[];
}

/** The single matcher: `resolveShellChrome` and `shellShowsReturnBanner` read
 *  the SAME row for a pathname, so a rule can never be in force for the mode
 *  and out of force for the banner. */
function matchRule(pathname: string): ShellRouteMatch | null {
    const pathSegments = segmentsOf(pathname);
    for (const rule of SHELL_ROUTE_RULES) {
        const patternSegments = segmentsOf(rule.pattern);
        if (matches(patternSegments, pathSegments))
            return { rule, patternSegments, pathSegments };
    }
    return null;
}

/** Substitute a rule's `$param` segments from the concrete pathname. */
function concreteExit(
    exitTo: string,
    patternSegments: string[],
    pathSegments: string[]
): string {
    const bindings = new Map<string, string>();
    patternSegments.forEach((seg, i) => {
        if (seg.startsWith("$")) bindings.set(seg, pathSegments[i]);
    });
    const resolved = segmentsOf(exitTo).map((seg) => bindings.get(seg) ?? seg);
    return resolved.length === 0 ? "/" : `/${resolved.join("/")}`;
}

/** The chrome the shell wraps `pathname` in. */
export function resolveShellChrome(pathname: string): ShellRouteChrome {
    const match = matchRule(pathname);
    // Unregistered: the 404 page, or a route someone added without classifying
    // it (which `shellChrome.test.ts` fails on). Browse is the right runtime
    // default — a not-found page with no way out is a trap.
    if (!match)
        return { mode: "browse", ownChrome: false, title: null, exitTo: null };
    const { rule, patternSegments, pathSegments } = match;
    return {
        mode: rule.mode,
        ownChrome: rule.ownChrome === true,
        title: rule.title ?? null,
        exitTo: rule.exitTo
            ? concreteExit(rule.exitTo, patternSegments, pathSegments)
            : null,
    };
}

/** Convenience for call sites that only care about the mode. */
export function resolveShellMode(pathname: string): ShellMode {
    return resolveShellChrome(pathname).mode;
}

/**
 * Which return the banner would offer, given what is in flight.
 *
 * A game outranks an event — it is the one that can time out on you — and this
 * is the SAME precedence `AppReturnBanner` renders by. Exported so the
 * component and the predicate cannot drift into disagreeing about which of the
 * two a route is being asked to suppress.
 */
export function shellReturnAffordance(session: {
    hasGame: boolean;
    eventId: string | null;
}): ReturnAffordance | null {
    if (session.hasGame) return "game";
    if (session.eventId !== null) return "event";
    return null;
}

/** Whether `match`'s route already offers `affordance` in full. */
function routeOwnsReturn(
    match: ShellRouteMatch,
    affordance: ReturnAffordance,
    eventId: string | null
): boolean {
    if (!(match.rule.ownsReturn ?? []).includes(affordance)) return false;
    if (affordance !== "event") return true;
    // A route that NAMES an event in its path owns only THAT event's return;
    // one that lists them (the lobby) owns whichever is running.
    const at = match.patternSegments.indexOf("$eventId");
    return at === -1 || match.pathSegments[at] === eventId;
}

/**
 * Whether the shell shows the global return banner at `pathname`.
 *
 * A pure predicate, and shared on purpose: `AppShell` renders the banner from
 * it and `shellBands` is charged `SHELL_RETURN_BANNER_PX` from the same
 * answer, so the band the model subtracts from `<main>` and the element the
 * shell actually mounts can never disagree. Two independent conditions would
 * be the #2274 shape again — a height nobody owns.
 *
 * Two things silence it, and they are different reasons. `ownChrome` (the
 * board) means the shell draws NO band here at all. `ownsReturn` means the
 * route already offers this exact return, in full — see that field: stacking
 * the band on top would be two resume affordances on one screen, which is the
 * ADR 0069 "one banner" rule and, at 390x844, 36px of the viewport this PRD
 * exists to reclaim.
 */
export function shellShowsReturnBanner(
    pathname: string,
    session: {
        hasGame: boolean;
        /** The active Limited event's id, when there is one. */
        eventId: string | null;
    }
): boolean {
    const affordance = shellReturnAffordance(session);
    if (affordance === null) return false;
    const match = matchRule(pathname);
    // Unregistered (the 404 page): nothing there owns anything, so the banner
    // is the only way back — the same fail-open the mode default takes.
    if (!match) return true;
    if (match.rule.ownChrome === true) return false;
    return !routeOwnsReturn(match, affordance, session.eventId);
}
