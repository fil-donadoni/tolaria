import { describe, expect, it } from "vitest";
import { router } from "~/router";

// Issue #2357: `/limited/events` (originally the your-events page, now a
// REDIRECT STUB to `/limited?mine=1` as of issue #2590 —
// `limited-your-events.route.tsx`) is a STATIC sibling of the already-
// registered dynamic `/limited/$eventId` (the event detail page). Both are
// declared as full literal paths off `rootRoute` (code-based routing, no
// file-tree codegen) — the same shape as the existing `/decks/create` vs
// `/decks/$slug` pair in `router.tsx`, so this asserts the SAME precedence
// that pair already relies on, rather than assuming it.
//
// This file asserts ROUTE MATCHING ONLY (`getMatchedRoutes`, no render), so
// issue #2590's redirect doesn't change what it proves: `/limited/events`
// still has to resolve to the STATIC route (`limitedYourEventsRoute`,
// component `LimitedYourEventsRoute`) rather than being swallowed by
// `$eventId` — the stub still needs a route to redirect FROM. What that
// route's component now DOES with the match (redirect instead of rendering a
// page) is covered separately by
// `src/routes/__tests__/limited-your-events-route.test.tsx`.
//
// `router.getMatchedRoutes` is a pure, synchronous route-tree lookup (no
// history/store, unlike `matchRoutes`) — exactly what a precedence check
// needs: which route WOULD win for a given pathname, without mounting the
// router or rendering anything.
describe("router: /limited/events vs /limited/$eventId precedence (issue #2357)", () => {
    it("routes /limited/events to the static your-events route, not the dynamic $eventId matcher", () => {
        const result = router.getMatchedRoutes("/limited/events");
        expect(result.foundRoute?.id).toBe("/limited/events");
        // The dynamic route would have produced an `eventId` param whose
        // value is literally the string "events" — the exact failure mode
        // this test guards against.
        expect(result.routeParams).not.toHaveProperty("eventId");
    });

    it("still routes an arbitrary event id to the dynamic detail route", () => {
        const result = router.getMatchedRoutes("/limited/abc123");
        expect(result.foundRoute?.id).toBe("/limited/$eventId");
        expect(result.routeParams).toEqual({ eventId: "abc123" });
    });

    it("still routes the bare /limited path to the lobby route", () => {
        const result = router.getMatchedRoutes("/limited");
        expect(result.foundRoute?.id).toBe("/limited");
    });
});
