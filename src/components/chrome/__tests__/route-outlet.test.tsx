import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
    RouterProvider,
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
} from "@tanstack/react-router";
import { router as appRouter } from "~/router";
import RouteOutlet from "../route-outlet";

// Issue #4854: the catalogue gate is mounted by `RouteOutlet` around every
// route that is not a declared `lightSurface`, so the login page and the lobby
// render without the catalogue chunk and everything else keeps the old
// guarantee (nothing reads the registry before it is hydrated).

vi.mock("~/components/ui/catalogue-gate", () => ({
    default: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="catalogue-gate">{children}</div>
    ),
}));

async function renderAt(path: string, lightSurface?: true) {
    const root = createRootRoute({ component: RouteOutlet });
    const page = createRoute({
        getParentRoute: () => root,
        path,
        staticData: lightSurface ? { lightSurface } : undefined,
        component: () => <div data-testid="page" />,
    });
    const router = createRouter({
        routeTree: root.addChildren([page]),
        history: createMemoryHistory({ initialEntries: [path] }),
    });
    render(<RouterProvider router={router} />);
    await screen.findByTestId("page");
}

describe("RouteOutlet", () => {
    it("mounts no gate around a lightSurface route", async () => {
        await renderAt("/lobby-like", true);
        expect(screen.queryByTestId("catalogue-gate")).toBeNull();
    });

    it("gates a route that declares nothing — gated is the default", async () => {
        await renderAt("/board-like");
        expect(
            (await screen.findByTestId("catalogue-gate")).contains(
                screen.getByTestId("page")
            )
        ).toBe(true);
    });
});

describe("which real routes opt out of the gate", () => {
    const lightSurface = (path: string) =>
        router
            .getMatchedRoutes(path)
            .matchedRoutes.filter((r) => r.id !== "__root__")
            .every((r) => r.options.staticData?.lightSurface === true);
    const router = appRouter;

    it("the lobby is a light surface", () => {
        expect(lightSurface("/")).toBe(true);
    });

    it.each([
        "/game",
        "/decks/create",
        "/decks/some-deck",
        "/decks/some-deck/edit",
        "/presets/create",
        "/join/abc",
        "/limited",
        "/limited/e1/draft",
        "/limited/e1/build",
        "/settings",
        "/admin",
        "/admin/draft-lab",
        "/admin/design-system",
    ])("%s stays behind the gate", (path) => {
        expect(lightSurface(path)).toBe(false);
    });
});
