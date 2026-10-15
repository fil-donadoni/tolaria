import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    default: ({
        mode,
        children,
    }: {
        mode?: string;
        children: React.ReactNode;
    }) => (
        <div data-testid="catalogue-gate" data-mode={mode}>
            {children}
        </div>
    ),
}));

async function renderAt(
    path: string,
    staticData?: { lightSurface?: true; catalogue?: "game" }
) {
    const root = createRootRoute({ component: RouteOutlet });
    const page = createRoute({
        getParentRoute: () => root,
        path,
        staticData,
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
        await renderAt("/lobby-like", { lightSurface: true });
        expect(screen.queryByTestId("catalogue-gate")).toBeNull();
    });

    it("gates a route that declares nothing — gated is the default, the whole catalogue", async () => {
        await renderAt("/board-like");
        const gate = await screen.findByTestId("catalogue-gate");
        expect(gate.contains(screen.getByTestId("page"))).toBe(true);
        expect(gate.dataset.mode).toBe("whole");
    });

    it("keys the gate by mode, so a game-mode gate never carries its readiness onto a whole route", () => {
        const outlet = readFileSync(
            resolve(__dirname, "../route-outlet.tsx"),
            "utf8"
        );
        expect(outlet).toMatch(
            /<CatalogueGateFrame key=\{need\} mode=\{need\}>/
        );
    });

    it("gates a route declaring catalogue: game in game mode (issue #5615)", async () => {
        await renderAt("/game-like", { catalogue: "game" });
        const gate = await screen.findByTestId("catalogue-gate");
        expect(gate.contains(screen.getByTestId("page"))).toBe(true);
        expect(gate.dataset.mode).toBe("game");
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

    it("the Constructed Setup flow is a light surface (issue #5584)", () => {
        expect(lightSurface("/play/constructed")).toBe(true);
    });

    it("the game route loads its own Sets; the join antechamber the whole catalogue (issue #5615)", () => {
        const catalogue = (path: string) =>
            router
                .getMatchedRoutes(path)
                .matchedRoutes.filter((r) => r.id !== "__root__")
                .map((r) => r.options.staticData?.catalogue);
        expect(catalogue("/game")).toEqual(["game"]);
        expect(catalogue("/join/abc")).toEqual([undefined]);
        expect(catalogue("/decks/create")).toEqual([undefined]);
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
