// The shell's route census (issue #2582, ADR 0101 §"AppShell").
//
// `shellChrome` used to answer one boolean with one `/game` prefix exception,
// and this file tested that boolean. v3 needs a two-mode RESOLVER, and the
// thing worth testing is no longer "does this string start with /game" — it is
// **exhaustiveness**: every route the app can reach lands in exactly one mode,
// on purpose, and a route nobody classified reds the gate.
//
// So the first describe below is a cross-check between `SHELL_ROUTE_RULES` and
// the REAL route tree (`router.routesById`, the same object
// `router-limited-precedence.test.ts` uses rather than a hand-built replica).
// A hand-written list of "routes I remember" would drift the day someone adds
// one — which is the exact failure the registry exists to prevent.
//
// The second describe is the mode table itself, one assertion per route
// family, written from `router.tsx` rather than from the implementation: the
// adjacent pairs (`/decks/$slug` vs `/decks/$slug/edit`, `/limited/$eventId`
// vs `/limited/$eventId/build`) are the rows a `startsWith` rule gets silently
// wrong, so they are asserted from both sides.
import { describe, it, expect } from "vitest";
import {
    SHELL_ROUTE_RULES,
    resolveShellChrome,
    resolveShellMode,
    shellShowsReturnBanner,
} from "@/lib/shellChrome";
import { router } from "~/router";

/** `/admin/` (the admin index route) and `/admin` (its layout) are one URL. */
function normalizeRouteId(id: string): string {
    return id.length > 1 ? id.replace(/\/+$/, "") : id;
}

/** Every URL the router can match, as path patterns. */
function routerPatterns(): string[] {
    const ids = Object.keys(router.routesById)
        .filter((id) => id !== "__root__")
        .map(normalizeRouteId);
    return [...new Set(ids)].sort();
}

/** A concrete pathname for a pattern, with `$param` segments filled in. */
function concretePath(pattern: string): string {
    return pattern
        .split("/")
        .map((seg) => (seg.startsWith("$") ? `id-${seg.slice(1)}` : seg))
        .join("/");
}

describe("shell route census: every router route is classified (issue #2582)", () => {
    it("classifies EXACTLY the routes the router declares — no more, no fewer", () => {
        // Both directions matter. A missing rule is a route silently taking
        // the `browse` runtime default; a surplus rule is a row nobody can
        // reach, which rots into a lie about how the shell behaves.
        expect(SHELL_ROUTE_RULES.map((rule) => rule.pattern).sort()).toEqual(
            routerPatterns()
        );
    });

    it("resolves a concrete pathname for every declared route", () => {
        // The registry could name the right patterns and still fail to MATCH
        // them (a `$param` segment mishandled, a trailing-slash difference).
        // Resolving a real pathname per rule is what proves the matcher, not
        // just the table.
        for (const rule of SHELL_ROUTE_RULES) {
            const path = concretePath(rule.pattern);
            expect(resolveShellChrome(path).mode, path).toBe(rule.mode);
        }
    });

    it("gives every immersive route with a shell bar a title and a way out", () => {
        // An immersive surface with no Exit is a trap: there is no nav to fall
        // back on, by construction.
        for (const rule of SHELL_ROUTE_RULES) {
            if (rule.mode !== "immersive" || rule.ownChrome) continue;
            const chrome = resolveShellChrome(concretePath(rule.pattern));
            expect(chrome.title, rule.pattern).toBeTruthy();
            expect(chrome.exitTo, rule.pattern).toBeTruthy();
        }
    });

    it("makes every declared exit target a route that actually exists", () => {
        // An Exit pointing at a 404 is worse than no Exit.
        for (const rule of SHELL_ROUTE_RULES) {
            if (!rule.exitTo) continue;
            const exit = resolveShellChrome(concretePath(rule.pattern)).exitTo!;
            expect(
                router.getMatchedRoutes(exit).foundRoute?.id,
                `${rule.pattern} -> ${exit}`
            ).toBeDefined();
        }
    });

    it("says WHY every route is classified the way it is", () => {
        // The `why` column is what makes the next person's addition a
        // decision rather than a copy of the row above it.
        for (const rule of SHELL_ROUTE_RULES) {
            expect(rule.why.length, rule.pattern).toBeGreaterThan(20);
        }
    });

    it("gives own chrome to exactly the two surfaces that draw their own bar", () => {
        // A CLOSED list, not a spot-check: `ownChrome` suppresses the shell
        // band AND the return banner AND `useActiveSession`, so a route that
        // takes it without drawing a bar of its own is a surface with no way
        // out. The board has its pause menu and dev rail; the Draft Room has
        // `LimitedDraftBar` (issue #2587), whose overflow is the only exit —
        // ADR 0101 §6 forbids an Event back-link during a pick, which is
        // exactly what a shell contextual bar would put back.
        expect(
            SHELL_ROUTE_RULES.filter((rule) => rule.ownChrome).map(
                (rule) => rule.pattern
            )
        ).toEqual(["/game", "/limited/$eventId/draft"]);
    });
});

describe("shell mode per route family (issue #2582)", () => {
    it.each([
        ["/", "browse"],
        ["/decks/create", "immersive"],
        ["/decks/goblins", "browse"],
        ["/decks/goblins/edit", "immersive"],
        ["/presets/create", "immersive"],
        ["/presets/burn/edit", "immersive"],
        ["/game", "immersive"],
        ["/join/j123", "browse"],
        ["/limited", "browse"],
        ["/limited/events", "browse"],
        ["/limited/e123", "browse"],
        ["/limited/e123/build", "immersive"],
        ["/admin", "browse"],
        ["/admin/scenarios", "browse"],
        ["/admin/banlists", "browse"],
        ["/admin/pick-ratings", "browse"],
        ["/admin/card-profiles", "browse"],
        ["/admin/bug-reports", "browse"],
        ["/admin/draft-lab", "browse"],
        ["/admin/design-system", "browse"],
    ] as const)("resolves %s as %s", (pathname, mode) => {
        expect(resolveShellMode(pathname)).toBe(mode);
    });

    it("keeps a deck's DETAIL page in Browse while its editor is Immersive", () => {
        // The pair a `startsWith("/decks")` rule collapses. Asserted from both
        // sides on the SAME slug so the difference cannot be the slug.
        expect(resolveShellMode("/decks/goblins")).toBe("browse");
        expect(resolveShellMode("/decks/goblins/edit")).toBe("immersive");
    });

    it("keeps a Limited event's page in Browse while its pool builder is Immersive", () => {
        expect(resolveShellMode("/limited/e123")).toBe("browse");
        expect(resolveShellMode("/limited/e123/build")).toBe("immersive");
    });

    it("does not let the static /limited/events page inherit the event detail's row", () => {
        // `/limited/events` and `/limited/$eventId` are the router's own
        // static-beats-dynamic pair (#2357); the registry matches by exact
        // pattern, so the static row must be declared, not inferred.
        expect(resolveShellChrome("/limited/events").mode).toBe("browse");
        expect(resolveShellChrome("/limited/events").exitTo).toBeNull();
    });

    it("does not treat a merely similar prefix as the board", () => {
        // `/games` is not `/game`. A naive `startsWith("/game")` would strip
        // the navigation off a future route with that name.
        expect(resolveShellChrome("/games").ownChrome).toBe(false);
        expect(resolveShellMode("/games")).toBe("browse");
    });

    it("does not let an unregistered child of the board inherit ownChrome", () => {
        // The pre-v3 rule was a `/game` PREFIX; the registry is exact. An
        // unclassified `/game/replay` therefore takes the 404 default —
        // navigable — rather than silently rendering with no chrome at all.
        expect(resolveShellChrome("/game/replay").ownChrome).toBe(false);
        expect(resolveShellMode("/game/replay")).toBe("browse");
    });

    it("gives an unknown path (the 404) Browse chrome, so it is never a dead end", () => {
        const chrome = resolveShellChrome("/no/such/page");
        expect(chrome).toEqual({
            mode: "browse",
            ownChrome: false,
            title: null,
            exitTo: null,
        });
    });

    it("ignores a trailing slash", () => {
        expect(resolveShellMode("/decks/goblins/edit/")).toBe("immersive");
        expect(resolveShellMode("/")).toBe("browse");
    });

    it("substitutes route params into the Exit target", () => {
        // The seat's builder exits to the event it belongs to, not to a
        // literal `$eventId`.
        expect(resolveShellChrome("/limited/e123/build").exitTo).toBe(
            "/limited/e123"
        );
        expect(resolveShellChrome("/decks/goblins/edit").exitTo).toBe(
            "/decks/goblins"
        );
    });
});

describe("shellShowsReturnBanner (issue #2582)", () => {
    const NOTHING = { hasGame: false, eventId: null };

    it("shows nothing when nothing is in flight", () => {
        expect(shellShowsReturnBanner("/", NOTHING)).toBe(false);
    });

    it("shows the banner on an ordinary Browse route with a game running", () => {
        expect(
            shellShowsReturnBanner("/decks/goblins", {
                hasGame: true,
                eventId: null,
            })
        ).toBe(true);
    });

    it("shows the banner on an Immersive route too — that is where it was missing", () => {
        expect(
            shellShowsReturnBanner("/decks/goblins/edit", {
                hasGame: true,
                eventId: null,
            })
        ).toBe(true);
    });

    it("never shows it on the board, which IS the thing it points at", () => {
        expect(
            shellShowsReturnBanner("/game", { hasGame: true, eventId: "e1" })
        ).toBe(false);
    });

    it("shows an event-only banner away from that event's own pages", () => {
        expect(
            shellShowsReturnBanner("/limited", {
                hasGame: false,
                eventId: "e1",
            })
        ).toBe(true);
        expect(
            shellShowsReturnBanner("/decks/goblins/edit", {
                hasGame: false,
                eventId: "e1",
            })
        ).toBe(true);
    });

    it("suppresses an event-only banner on that event's own detail and builder", () => {
        expect(
            shellShowsReturnBanner("/limited/e1", {
                hasGame: false,
                eventId: "e1",
            })
        ).toBe(false);
        expect(
            shellShowsReturnBanner("/limited/e1/build", {
                hasGame: false,
                eventId: "e1",
            })
        ).toBe(false);
    });

    it("still shows a DIFFERENT event's banner on an event page", () => {
        expect(
            shellShowsReturnBanner("/limited/e2", {
                hasGame: false,
                eventId: "e1",
            })
        ).toBe(true);
    });

    it("keeps the GAME banner on the active event's own pages — a game outranks an event", () => {
        expect(
            shellShowsReturnBanner("/limited/e1/build", {
                hasGame: true,
                eventId: "e1",
            })
        ).toBe(true);
    });

    // #2619 review (blocking): the lobby has resumed a game since #155 and
    // listed live events since #2357. Adding the shell band on top put TWO
    // resume affordances for the SAME session on the app's primary route.
    it("stands down on the lobby, which owns both returns in full", () => {
        expect(
            shellShowsReturnBanner("/", { hasGame: true, eventId: null })
        ).toBe(false);
        expect(
            shellShowsReturnBanner("/", { hasGame: false, eventId: "e1" })
        ).toBe(false);
        expect(
            shellShowsReturnBanner("/", { hasGame: true, eventId: "e1" })
        ).toBe(false);
    });

    it("still shows the banner one route away from the lobby", () => {
        // Ownership is per ROUTE, never "anything lobby-ish": walking into the
        // deck list is exactly the case the band exists for.
        expect(
            shellShowsReturnBanner("/decks/goblins", {
                hasGame: true,
                eventId: null,
            })
        ).toBe(true);
    });

    it("shows the banner on an unregistered path — nothing there owns a return", () => {
        // The 404 page. Fail-open, like the `browse` mode default: a page with
        // no nav and no banner is a dead end.
        expect(
            shellShowsReturnBanner("/nope/nowhere", {
                hasGame: true,
                eventId: null,
            })
        ).toBe(true);
    });
});

describe("return-affordance ownership census (issue #2582, #2619 review)", () => {
    it("never declares ownsReturn on a route that renders no band anyway", () => {
        // `ownChrome` already silences the banner. A row claiming both would
        // be two reasons for one outcome — the shape that rots into one of
        // them being quietly wrong.
        for (const rule of SHELL_ROUTE_RULES) {
            if (!rule.ownChrome) continue;
            expect(rule.ownsReturn, rule.pattern).toBeUndefined();
        }
    });

    it("declares a non-empty, well-formed claim wherever it declares one", () => {
        for (const rule of SHELL_ROUTE_RULES) {
            if (!rule.ownsReturn) continue;
            expect(rule.ownsReturn.length, rule.pattern).toBeGreaterThan(0);
            expect(new Set(rule.ownsReturn).size, rule.pattern).toBe(
                rule.ownsReturn.length
            );
        }
    });

    it("keeps the owning routes to the ones that really render a return", () => {
        // The census's job: a route added tomorrow cannot silently acquire (or
        // silently lose) ownership. `/` is `ActiveGameNotice` +
        // `DashboardLimitedBox`; the two `/limited/$eventId*` rows are the
        // event's own pages.
        const owners = SHELL_ROUTE_RULES.filter((rule) => rule.ownsReturn).map(
            (rule) => rule.pattern
        );
        expect(owners.sort()).toEqual([
            "/",
            "/limited/$eventId",
            "/limited/$eventId/build",
        ]);
    });
});
