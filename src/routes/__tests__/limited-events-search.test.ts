import { describe, it, expect } from "vitest";
import { router } from "~/router";

// Issue #2590's `mine` filter, exercised through the REAL router
// (`router.options.parseSearch` + the `/limited` route's own
// `validateSearch`, `router.routesById["/limited"].options.validateSearch`)
// rather than as a component prop. This is the seam the round-2 review
// (PR #2651) found broken: TanStack's default `parseSearch` JSON-parses
// every query-string value, so the literal, bookmarkable URL `?mine=1` (the
// one named in the issue AC, the PR title, `limited-your-events.route.tsx`'s
// doc comment, `docs/guides/ui-runbooks.md` and the `budgets.json` label)
// arrives at `validateSearch` as the NUMBER `1`, not the string `"1"` — the
// old `search.mine === "1"` branch was unreachable dead code, and every test
// in `limited-events-page.test.tsx` passed `mine` as a prop, bypassing this
// translation entirely and staying green over the bug.
//
// `validateSearch` is not exported (it is inline in `createRoute`), so this
// reaches it the same way `router-limited-precedence.test.ts` reaches route
// matching: off the live `router` instance, never a hand-built replica.
function validateLimitedSearch(queryString: string): {
    mine?: true;
    label?: string;
} {
    const parsed = router.options.parseSearch(queryString);
    const route = router.routesById["/limited"];
    const validateSearch = route.options.validateSearch as (
        search: Record<string, unknown>
    ) => { mine?: true; label?: string };
    return validateSearch(parsed);
}

describe("/limited route search: mine filter (issue #2590)", () => {
    it("turns the filter on for the bookmarkable ?mine=1 URL (parses to the number 1)", () => {
        expect(validateLimitedSearch("?mine=1")).toEqual({ mine: true });
    });

    it("turns the filter on for the in-app redirect's ?mine=true URL", () => {
        expect(validateLimitedSearch("?mine=true")).toEqual({ mine: true });
    });

    it("leaves the filter off when mine is absent", () => {
        expect(validateLimitedSearch("")).toEqual({});
    });

    it("leaves the filter off for an unrelated truthy-looking value", () => {
        expect(validateLimitedSearch("?mine=yes")).toEqual({});
    });
});

// The fixture-label filter (issue #2822) goes through the SAME JSON-parsing
// seam as `mine` above, and it is what bounds the two `check:ui` list
// surfaces to the seeded fixture. Reached off the live router, never a
// hand-built replica of `validateSearch`.
describe("/limited route search: fixture label filter (issue #2822)", () => {
    it("keeps the fixture label prefix the check:ui lane navigates to", () => {
        expect(validateLimitedSearch("?label=ui-gate/")).toEqual({
            label: "ui-gate/",
        });
    });

    it("keeps a full fixture label alongside the mine filter", () => {
        expect(validateLimitedSearch("?mine=1&label=ui-gate/draft")).toEqual({
            mine: true,
            label: "ui-gate/draft",
        });
    });

    it("drops an empty ?label= rather than filtering the list down to nothing", () => {
        expect(validateLimitedSearch("?label=")).toEqual({});
    });

    it("drops a non-string label (parseSearch JSON-parses, so ?label=1 is a number)", () => {
        expect(validateLimitedSearch("?label=1")).toEqual({});
    });
});
