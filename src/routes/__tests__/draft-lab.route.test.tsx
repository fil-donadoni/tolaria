// `/admin/draft-lab` behind the admin section gate (ADR 0074). The Draft Lab
// is a developer surface: it exposes the Bot Drafter's scoring internals, every
// bot seat's Pool mid-draft, and — in replay mode — a completed Draft event
// reconstructed from its `seed`, which regenerates every seat's Pool and is
// therefore released to an admin alone (`convex/limited/eventProjection.ts`).
//
// The composition under test is production's: `AdminLayoutRoute` wraps every
// `/admin/*` page in `AdminRouteGate`, so the page is rendered here THROUGH
// that gate rather than in isolation. Two assertions matter, and the second is
// the load-bearing one:
//
//  1. a non-admin gets a plain 404, never the workbench and never an
//     explanation that would confirm the surface exists;
//  2. a non-admin never even CONSTRUCTS the admin-gated queries the workbench's
//     hooks call (`listScopeCardProfiles`). React forbids conditional hooks, so
//     this only holds because the workbench is a SEPARATE component mounted on
//     the gate's admin branch — inline it back into the route and `useDraftLab`
//     would run for everyone, firing a query the server now rejects. This test
//     is what fails if someone does. (Mirrors
//     `card-profile-admin-panel.test.tsx`'s "never even CONSTRUCTS" case.)
//
// convex/react is mocked so the gate is exercised with no live backend.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminRouteGate from "@/components/chrome/admin-route-gate";
import DraftLabRoute from "../draft-lab.route";

let currentUser: { isAdmin?: boolean } | null | undefined;
const useQueryCalls: { name: string; args: unknown }[] = [];

vi.mock("convex/react", () => ({
    useQuery: (query: { _name: string }, args: unknown) => {
        useQueryCalls.push({ name: query._name, args });
        if (query._name === "listScopeCardProfiles") return [];
        return undefined;
    },
}));

// A real `api` reference carries no readable name, so stub the generated api
// with a Proxy that turns any `api.a.b.c` access into `{ _name: "c" }` — the
// mocked `useQuery` above keys off that. A Proxy rather than a hand-written
// object literal so a hook reaching for a DIFFERENT query still resolves
// (returning `undefined` from `useQuery`, i.e. "loading") instead of throwing
// and turning a gate regression into an unrelated TypeError.
vi.mock("@convex/_generated/api", () => {
    const leaf = (name: string): unknown =>
        new Proxy(
            { _name: name },
            {
                get: (target, prop) =>
                    prop === "_name" || typeof prop === "symbol"
                        ? Reflect.get(target, prop)
                        : leaf(String(prop)),
            }
        );
    return { api: leaf("") };
});

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => currentUser,
}));

function renderGated() {
    return render(
        <AdminRouteGate>
            <DraftLabRoute />
        </AdminRouteGate>
    );
}

describe("Draft Lab behind the admin gate (ADR 0074)", () => {
    beforeEach(() => {
        currentUser = { isAdmin: true };
        useQueryCalls.length = 0;
    });

    it("renders the workbench for an admin", () => {
        renderGated();
        expect(screen.getByText("Draft Lab")).toBeTruthy();
        expect(screen.queryByText("Page not found")).toBeNull();
    });

    it("renders a 404 for a non-admin — no workbench, no explanation", () => {
        currentUser = { isAdmin: false };
        renderGated();
        expect(screen.getByText("Page not found")).toBeTruthy();
        expect(screen.queryByText("Draft Lab")).toBeNull();
        // The 404 must not leak WHY: no admin/permission wording anywhere.
        expect(document.body.textContent).not.toMatch(/admin|permission/i);
    });

    it("renders a 404 when signed out (null)", () => {
        currentUser = null;
        renderGated();
        expect(screen.getByText("Page not found")).toBeTruthy();
    });

    it("renders neither the workbench nor the 404 while the user loads", () => {
        currentUser = undefined;
        const { container } = renderGated();
        expect(container.firstChild).toBeNull();
    });

    it("never CONSTRUCTS the admin-gated Card Profile query for a non-admin", () => {
        currentUser = { isAdmin: false };
        renderGated();
        expect(
            useQueryCalls.some((c) => c.name === "listScopeCardProfiles")
        ).toBe(false);
    });

    it("never constructs it while the user is still loading either", () => {
        currentUser = undefined;
        renderGated();
        expect(useQueryCalls).toEqual([]);
    });

    it("DOES construct it for an admin — proving the negative cases above bite", () => {
        renderGated();
        expect(
            useQueryCalls.some((c) => c.name === "listScopeCardProfiles")
        ).toBe(true);
    });
});
