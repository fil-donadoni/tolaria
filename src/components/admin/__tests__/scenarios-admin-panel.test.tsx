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
const forfeitMatch = vi.fn();
const manualConcedeMatch = vi.fn();
const leaveGame = vi.fn();
/** Call order across the whole flow, so "create → apply → navigate" is
 *  asserted as a sequence rather than three independent facts. */
let calls: string[] = [];
/** `myActiveGame`'s current mock return — issue #2400's typed marker the
 *  hook reads to distinguish an active-game block from any other
 *  createSoloGame/debugSetupScenario failure. `undefined` (the default) is
 *  "no active game", matching the real query's loading/absent states. */
let activeGame: Record<string, unknown> | undefined;

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
        if (query._name === "myActiveGame") return activeGame;
        return undefined;
    },
    useMutation: (fn: { _name: string }) => {
        if (fn._name === "createSoloGame") return createSoloGame;
        if (fn._name === "debugSetupScenario") return setupScenario;
        if (fn._name === "deleteDebugScenario") return deleteScenario;
        if (fn._name === "setDebugScenarioGolden") return setGolden;
        if (fn._name === "cleanupEphemeralScenarios") return cleanup;
        if (fn._name === "forfeitMatch") return forfeitMatch;
        if (fn._name === "manualConcedeMatch") return manualConcedeMatch;
        if (fn._name === "leaveGame") return leaveGame;
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
        activeGame = undefined;
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
        forfeitMatch.mockResolvedValue(undefined);
        manualConcedeMatch.mockResolvedValue(undefined);
        leaveGame.mockResolvedValue(undefined);
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

    describe("active-game block (issue #2400)", () => {
        const VS_AI_GAME = {
            gameId: "g0",
            matchId: "m0",
            name: "Existing",
            status: "playing",
            solo: true,
            vsAi: true,
            mode: null,
            opponentName: "Bot",
        };

        it("shows a confirm dialog naming the game's type/opponent, not the error banner", async () => {
            activeGame = VS_AI_GAME;
            createSoloGame.mockRejectedValueOnce(
                new Error(
                    "You already have an active game. Finish or leave it before starting another."
                )
            );
            render(<ScenariosAdminPanel />);
            fireEvent.click(screen.getAllByText("Test")[0]);

            await waitFor(() =>
                expect(screen.getByText("Concede active game?")).toBeTruthy()
            );
            // GameDialog renders the subtitle twice (visible `<p>` plus an
            // sr-only `DialogDescription` mirror) — assert on the count.
            expect(
                screen.getAllByText(/active solo game vs Bot/).length
            ).toBeGreaterThan(0);
            expect(
                screen.queryByText(
                    "You already have an active game. Finish or leave it before starting another."
                )
            ).toBeNull();
            // No mutation fired yet — only the dialog appeared.
            expect(forfeitMatch).not.toHaveBeenCalled();
        });

        it("confirming concedes via forfeitMatch (never the per-Game concede) then retries the launch", async () => {
            activeGame = VS_AI_GAME;
            createSoloGame.mockRejectedValueOnce(new Error("blocked"));
            render(<ScenariosAdminPanel />);
            fireEvent.click(screen.getAllByText("Test")[0]);
            await waitFor(() =>
                expect(screen.getByText("Concede active game?")).toBeTruthy()
            );

            fireEvent.click(screen.getByText("Concede & Start"));

            await waitFor(() => expect(navigate).toHaveBeenCalled());
            expect(forfeitMatch).toHaveBeenCalledWith({
                matchId: "m0",
                playerId: "user-1-p1",
            });
            expect(createSoloGame).toHaveBeenCalledTimes(2);
            expect(setupScenario).toHaveBeenCalledTimes(1);
            expect(navigate).toHaveBeenCalledWith({ to: "/game" });
            expect(screen.queryByText("Concede active game?")).toBeNull();
        });

        it("routes a manual-mode block through manualConcedeMatch as the P1 seat", async () => {
            activeGame = {
                ...VS_AI_GAME,
                vsAi: false,
                mode: "manual",
                opponentName: null,
            };
            createSoloGame.mockRejectedValueOnce(new Error("blocked"));
            render(<ScenariosAdminPanel />);
            fireEvent.click(screen.getAllByText("Test")[0]);
            await waitFor(() =>
                expect(
                    screen.getAllByText(/active manual game/).length
                ).toBeGreaterThan(0)
            );

            fireEvent.click(screen.getByText("Concede & Start"));

            await waitFor(() => expect(navigate).toHaveBeenCalled());
            expect(manualConcedeMatch).toHaveBeenCalledWith({
                gameId: "g0",
                playerId: "user-1-p1",
            });
            expect(forfeitMatch).not.toHaveBeenCalled();
        });

        it("labels a non-solo block 2-player and forfeits the bare user-id seat", async () => {
            activeGame = {
                ...VS_AI_GAME,
                solo: false,
                vsAi: false,
                opponentName: "Rival",
            };
            createSoloGame.mockRejectedValueOnce(new Error("blocked"));
            render(<ScenariosAdminPanel />);
            fireEvent.click(screen.getAllByText("Test")[0]);
            await waitFor(() =>
                expect(
                    screen.getAllByText(/active 2-player game vs Rival/).length
                ).toBeGreaterThan(0)
            );

            fireEvent.click(screen.getByText("Concede & Start"));

            await waitFor(() =>
                expect(forfeitMatch).toHaveBeenCalledWith({
                    matchId: "m0",
                    playerId: "user-1",
                })
            );
        });

        it("routes a non-solo manual-mode block through manualConcedeMatch as the bare user-id seat", async () => {
            // #2400 review round 2, finding 5: a genuine 2-player manual
            // table seats the caller as the bare user id, not `-p1` — the
            // same derivation the non-manual branch already used.
            activeGame = {
                ...VS_AI_GAME,
                solo: false,
                vsAi: false,
                mode: "manual",
                opponentName: "Rival",
            };
            createSoloGame.mockRejectedValueOnce(new Error("blocked"));
            render(<ScenariosAdminPanel />);
            fireEvent.click(screen.getAllByText("Test")[0]);
            await waitFor(() =>
                expect(
                    screen.getAllByText(/active manual game vs Rival/).length
                ).toBeGreaterThan(0)
            );

            fireEvent.click(screen.getByText("Concede & Start"));

            await waitFor(() =>
                expect(manualConcedeMatch).toHaveBeenCalledWith({
                    gameId: "g0",
                    playerId: "user-1",
                })
            );
            expect(forfeitMatch).not.toHaveBeenCalled();
        });

        it("frees a waiting (unjoined) block via leaveGame, not forfeitMatch, then retries", async () => {
            // #2400 review round 2, finding 1: a lobby-created Match nobody
            // joined has ONE seat — `forfeitMatch`'s opponent lookup throws
            // "Seat not found in this match" for it. `status !== "playing"`
            // must route through `leaveGame` instead, mirroring
            // `ActiveGameNotice`'s non-`playing` branch.
            activeGame = { ...VS_AI_GAME, status: "waiting", vsAi: false };
            createSoloGame.mockRejectedValueOnce(new Error("blocked"));
            render(<ScenariosAdminPanel />);
            fireEvent.click(screen.getAllByText("Test")[0]);
            await waitFor(() =>
                expect(screen.getByText("Concede active game?")).toBeTruthy()
            );

            fireEvent.click(screen.getByText("Concede & Start"));

            await waitFor(() => expect(navigate).toHaveBeenCalled());
            expect(leaveGame).toHaveBeenCalledWith({ gameId: "g0" });
            expect(forfeitMatch).not.toHaveBeenCalled();
            expect(manualConcedeMatch).not.toHaveBeenCalled();
            expect(createSoloGame).toHaveBeenCalledTimes(2);
            expect(navigate).toHaveBeenCalledWith({ to: "/game" });
        });

        it("a retried createSoloGame failure surfaces via the plain banner, never re-opening the confirm dialog", async () => {
            // #2400 review round 2, finding 3: the retry must not re-enter
            // the `if (activeGame) -> setBlockingActiveGame` branch even
            // though the `myActiveGame` mock still reports the (just
            // conceded) game truthy — proving the fix does not merely rely
            // on the mock happening to go falsy after the concede.
            activeGame = VS_AI_GAME;
            createSoloGame
                .mockRejectedValueOnce(new Error("blocked"))
                .mockRejectedValueOnce(new Error("Still no dice."));
            render(<ScenariosAdminPanel />);
            fireEvent.click(screen.getAllByText("Test")[0]);
            await waitFor(() =>
                expect(screen.getByText("Concede active game?")).toBeTruthy()
            );

            fireEvent.click(screen.getByText("Concede & Start"));

            await waitFor(() =>
                expect(screen.getByText("Still no dice.")).toBeTruthy()
            );
            expect(screen.queryByText("Concede active game?")).toBeNull();
            expect(createSoloGame).toHaveBeenCalledTimes(2);
            expect(forfeitMatch).toHaveBeenCalledTimes(1);
        });

        it("still surfaces a debugSetupScenario failure via the plain banner even when activeGame is already non-null", async () => {
            // #2400 review round 2, finding 4: the two try/catch blocks in
            // `launch` must stay independent. `activeGame` reporting
            // non-null here simulates the reactive `myActiveGame`
            // subscription already having picked up the game THIS call just
            // created by the time `debugSetupScenario` fails — the exact
            // condition the PR's docstring calls out. If the two catches
            // were ever collapsed into the same `if (activeGame)` shape,
            // this would wrongly show the confirm dialog instead.
            activeGame = VS_AI_GAME;
            setupScenario.mockRejectedValueOnce(
                new Error("Scenario spec invalid.")
            );
            render(<ScenariosAdminPanel />);
            fireEvent.click(screen.getAllByText("Test")[0]);

            await waitFor(() =>
                expect(screen.getByText("Scenario spec invalid.")).toBeTruthy()
            );
            expect(screen.queryByText("Concede active game?")).toBeNull();
            expect(forfeitMatch).not.toHaveBeenCalled();
            expect(manualConcedeMatch).not.toHaveBeenCalled();
        });

        it("cancelling fires no mutation and leaves the active game untouched", async () => {
            activeGame = VS_AI_GAME;
            createSoloGame.mockRejectedValueOnce(new Error("blocked"));
            render(<ScenariosAdminPanel />);
            fireEvent.click(screen.getAllByText("Test")[0]);
            await waitFor(() =>
                expect(screen.getByText("Concede active game?")).toBeTruthy()
            );

            fireEvent.click(screen.getByText("Cancel"));

            expect(screen.queryByText("Concede active game?")).toBeNull();
            expect(forfeitMatch).not.toHaveBeenCalled();
            expect(manualConcedeMatch).not.toHaveBeenCalled();
            expect(createSoloGame).toHaveBeenCalledTimes(1);
        });

        it("disables the confirm button while the concede mutation is in flight", async () => {
            activeGame = VS_AI_GAME;
            createSoloGame.mockRejectedValueOnce(new Error("blocked"));
            let resolveForfeit: () => void = () => {};
            forfeitMatch.mockImplementation(
                () =>
                    new Promise<void>((resolve) => {
                        resolveForfeit = resolve;
                    })
            );
            render(<ScenariosAdminPanel />);
            fireEvent.click(screen.getAllByText("Test")[0]);
            await waitFor(() =>
                expect(screen.getByText("Concede active game?")).toBeTruthy()
            );

            fireEvent.click(screen.getByText("Concede & Start"));

            await waitFor(() =>
                expect(
                    (
                        screen.getByRole("button", {
                            name: "Conceding…",
                        }) as HTMLButtonElement
                    ).disabled
                ).toBe(true)
            );
            expect(
                (
                    screen.getByRole("button", {
                        name: "Cancel",
                    }) as HTMLButtonElement
                ).disabled
            ).toBe(true);

            resolveForfeit();
            await waitFor(() => expect(navigate).toHaveBeenCalled());
        });

        it("still surfaces a non-active-game createSoloGame failure via the plain banner", async () => {
            // No active game reported — this is some other rejection (e.g. a
            // deck-legality error), so the typed marker never fires and the
            // dialog must not appear.
            activeGame = undefined;
            createSoloGame.mockRejectedValueOnce(
                new Error("Deck is not legal for this format.")
            );
            render(<ScenariosAdminPanel />);
            fireEvent.click(screen.getAllByText("Test")[0]);

            await waitFor(() =>
                expect(
                    screen.getByText("Deck is not legal for this format.")
                ).toBeTruthy()
            );
            expect(screen.queryByText("Concede active game?")).toBeNull();
            expect(forfeitMatch).not.toHaveBeenCalled();
        });
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
