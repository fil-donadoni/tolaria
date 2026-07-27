// `/admin/scenarios` — the "Test" affordance (start a solo game on a saved
// scenario) and the page's list wiring. The ORDER of the three steps is the
// thing worth pinning: create the game, apply the scenario, and only then
// navigate. Navigating first would show a frame of the freshly dealt opening
// hand before the scenario replaced the board.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ScenariosAdminPanel from "../scenarios-admin-panel";

const navigate = vi.fn();
const createSoloGame = vi.fn();
const setupScenario = vi.fn();
const deleteScenario = vi.fn();
const setGolden = vi.fn();
const cleanup = vi.fn();
/** Call order across the whole flow, so "create → apply → navigate" is
 *  asserted as a sequence rather than three independent facts. */
let calls: string[] = [];

const SCENARIOS = [
    {
        _id: "sc1",
        _creationTime: 0,
        label: "Lethal on board",
        spec: { cards: [{ name: "Mountain", zone: "battlefield" }] },
        golden: true,
        userId: "user-1",
        createdAt: 0,
    },
    {
        _id: "sc2",
        _creationTime: 0,
        label: "Stack war",
        spec: { cards: [] },
        userId: "user-1",
        createdAt: 0,
    },
];

const PRESETS = [
    {
        presetId: "mono-red-burn",
        name: "Mono Red Burn",
        description: "Burn",
        format: "old-school",
        colors: ["R"],
        cards: [{ id: "card-a", quantity: 4 }],
        sideboard: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
    },
];

vi.mock("convex/react", () => ({
    useQuery: (query: { _name: string }) => {
        if (query._name === "listDebugScenarios") return SCENARIOS;
        if (query._name === "list") return PRESETS;
        return undefined;
    },
    useMutation: (fn: { _name: string }) => {
        if (fn._name === "createSoloGame") return createSoloGame;
        if (fn._name === "debugSetupScenario") return setupScenario;
        if (fn._name === "deleteDebugScenario") return deleteScenario;
        if (fn._name === "setDebugScenarioGolden") return setGolden;
        if (fn._name === "cleanupEphemeralScenarios") return cleanup;
        return vi.fn();
    },
    useAction: () => vi.fn(),
}));

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

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({
        _id: "user-1",
        nickname: "Tester",
        isAdmin: true,
    }),
}));

describe("ScenariosAdminPanel", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        calls = [];
        localStorage.clear();
        createSoloGame.mockImplementation(async () => {
            calls.push("create");
            return "game-1";
        });
        setupScenario.mockImplementation(async () => {
            calls.push("setup");
        });
        navigate.mockImplementation(() => {
            calls.push("navigate");
        });
    });

    it("lists every saved scenario", () => {
        render(<ScenariosAdminPanel />);
        expect(screen.getByText("Lethal on board")).toBeTruthy();
        expect(screen.getByText("Stack war")).toBeTruthy();
    });

    it("offers a Test button per row", () => {
        render(<ScenariosAdminPanel />);
        expect(screen.getAllByText("Test").length).toBe(SCENARIOS.length);
    });

    it("Test creates a solo game, applies the scenario, then navigates — in that order", async () => {
        render(<ScenariosAdminPanel />);
        fireEvent.click(screen.getAllByText("Test")[0]);

        await waitFor(() => expect(navigate).toHaveBeenCalled());
        expect(calls).toEqual(["create", "setup", "navigate"]);

        expect(createSoloGame).toHaveBeenCalledTimes(1);
        expect(createSoloGame.mock.calls[0][0].name).toBe(
            "Scenario: Lethal on board"
        );
        // A scenario is a position, not a match.
        expect(createSoloGame.mock.calls[0][0].bestOf).toBe(1);

        // The spec is applied to the game just created, normalized (ADR 0044).
        expect(setupScenario).toHaveBeenCalledTimes(1);
        expect(setupScenario.mock.calls[0][0].gameId).toBe("game-1");
        expect(setupScenario.mock.calls[0][0].cards).toEqual([
            expect.objectContaining({ name: "Mountain", zone: "battlefield" }),
        ]);

        expect(navigate).toHaveBeenCalledWith({ to: "/game" });
    });

    it("surfaces a failed create instead of navigating to an empty board", async () => {
        createSoloGame.mockRejectedValueOnce(
            new Error("You already have an active game")
        );
        render(<ScenariosAdminPanel />);
        fireEvent.click(screen.getAllByText("Test")[0]);

        await waitFor(() =>
            expect(
                screen.getByText("You already have an active game")
            ).toBeTruthy()
        );
        expect(setupScenario).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
    });

    it("filters the list by label", () => {
        render(<ScenariosAdminPanel />);
        fireEvent.change(screen.getByPlaceholderText("Search scenarios…"), {
            target: { value: "stack" },
        });
        expect(screen.queryByText("Lethal on board")).toBeNull();
        expect(screen.getByText("Stack war")).toBeTruthy();
    });
});
