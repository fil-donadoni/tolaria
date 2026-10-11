import { describe, it, expect } from "vitest";
import { router } from "~/router";

// The hub's `?status=` chips and the retired `?mine=` filter (issues #2590,
// #5388), exercised through the REAL router (`router.options.parseSearch` +
// the `/limited` route's own `validateSearch`,
// `router.routesById["/limited"].options.validateSearch`) rather than as a
// component prop: TanStack's default `parseSearch` JSON-parses every
// query-string value, so a test that hands the page a prop bypasses this
// translation entirely and stays green over a broken URL contract.
//
// `validateSearch` is not exported (it is inline in `createRoute`), so this
// reaches it the same way `router-limited-precedence.test.ts` reaches route
// matching: off the live `router` instance, never a hand-built replica.
function validateLimitedSearch(queryString: string): {
    status?: string;
    label?: string;
} {
    const parsed = router.options.parseSearch(queryString);
    const route = router.routesById["/limited"];
    const validateSearch = route.options.validateSearch as (
        search: Record<string, unknown>
    ) => { status?: string; label?: string };
    return validateSearch(parsed);
}

describe("/limited route search: status chips (issue #5388)", () => {
    it.each(["waiting", "drafting", "building", "playing", "history"])(
        "accepts the hub value ?status=%s",
        (status) => {
            expect(validateLimitedSearch(`?status=${status}`)).toEqual({
                status,
            });
        }
    );

    it("maps the pre-hub open / done values onto waiting / history", () => {
        expect(validateLimitedSearch("?status=open")).toEqual({
            status: "waiting",
        });
        expect(validateLimitedSearch("?status=done")).toEqual({
            status: "history",
        });
    });

    it("drops an unrecognized status", () => {
        expect(validateLimitedSearch("?status=nope")).toEqual({});
    });

    it("no longer filters on ?mine= — an old link lands on the plain hub", () => {
        expect(validateLimitedSearch("?mine=1")).toEqual({});
        expect(validateLimitedSearch("?mine=true")).toEqual({});
    });
});

// The fixture-label filter (issue #2822) goes through the SAME JSON-parsing
// seam as `status` above, and it is what bounds the two `check:ui` list
// surfaces to the seeded fixture. Reached off the live router, never a
// hand-built replica of `validateSearch`.
describe("/limited route search: fixture label filter (issue #2822)", () => {
    it("keeps the fixture label prefix the check:ui lane navigates to", () => {
        expect(validateLimitedSearch("?label=ui-gate/")).toEqual({
            label: "ui-gate/",
        });
    });

    it("keeps a full fixture label alongside a status chip", () => {
        expect(
            validateLimitedSearch("?status=drafting&label=ui-gate/draft")
        ).toEqual({
            status: "drafting",
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
