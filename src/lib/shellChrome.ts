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
        why: "Lobby — the app's primary destination; nav is the point of it.",
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
        why: "Event detail / antechamber. The immersive Draft Room is its OWN route in issue #2587, not this one.",
    },
    {
        pattern: "/limited/$eventId/build",
        mode: "immersive",
        title: "Build your deck",
        exitTo: "/limited/$eventId",
        why: "The pool-scoped deck builder — immersive like the constructed one.",
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
    const pathSegments = segmentsOf(pathname);
    for (const rule of SHELL_ROUTE_RULES) {
        const patternSegments = segmentsOf(rule.pattern);
        if (!matches(patternSegments, pathSegments)) continue;
        return {
            mode: rule.mode,
            ownChrome: rule.ownChrome === true,
            title: rule.title ?? null,
            exitTo: rule.exitTo
                ? concreteExit(rule.exitTo, patternSegments, pathSegments)
                : null,
        };
    }
    // Unregistered: the 404 page, or a route someone added without classifying
    // it (which `shellChrome.test.ts` fails on). Browse is the right runtime
    // default — a not-found page with no way out is a trap.
    return { mode: "browse", ownChrome: false, title: null, exitTo: null };
}

/** Convenience for call sites that only care about the mode. */
export function resolveShellMode(pathname: string): ShellMode {
    return resolveShellChrome(pathname).mode;
}

/**
 * Whether the shell shows the global return banner at `pathname`.
 *
 * A pure predicate, and shared on purpose: `AppShell` renders the banner from
 * it and `shellBands` is charged `SHELL_RETURN_BANNER_PX` from the same
 * answer, so the band the model subtracts from `<main>` and the element the
 * shell actually mounts can never disagree. Two independent conditions would
 * be the #2274 shape again — a height nobody owns.
 */
export function shellShowsReturnBanner(
    pathname: string,
    session: {
        hasGame: boolean;
        /** The active Limited event's id, when there is one. */
        eventId: string | null;
    }
): boolean {
    if (!session.hasGame && session.eventId === null) return false;
    // On the board you ARE the thing the banner points at, and the surface
    // renders no shell chrome at all.
    if (resolveShellChrome(pathname).ownChrome) return false;
    // An event-only banner is noise on the event's own pages (detail, build).
    if (!session.hasGame && session.eventId !== null) {
        const here = segmentsOf(pathname);
        if (here[0] === "limited" && here[1] === session.eventId) return false;
    }
    return true;
}
