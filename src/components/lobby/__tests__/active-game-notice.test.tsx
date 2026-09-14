// The lobby's single-active-game banner (#155). Focus: the Concede path picks
// the right seat for `manualConcedeMatch` (#2400 review round 2, blocking,
// round 3) — `manualConcedeMatch` now fails CLOSED on a seat that isn't
// actually in the Match (`computeForfeitMatch` returning `null`), so passing
// the hardcoded solo seat (`${userId}-p1`) for a genuine 2-player Tabletop
// table throws, and `handleForfeit` has no `catch` to surface it: the dialog
// just stays open forever with no message.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import ActiveGameNotice, { type ActiveGame } from "../active-game-notice";

const navigate = vi.fn();
const forfeitMatch = vi.fn();
const manualConcedeMatch = vi.fn();
const leaveGame = vi.fn();

vi.mock("convex/react", () => ({
    useMutation: (fn: { _name: string }) => {
        if (fn._name === "forfeitMatch") return forfeitMatch;
        if (fn._name === "manualConcedeMatch") return manualConcedeMatch;
        if (fn._name === "leaveGame") return leaveGame;
        return vi.fn();
    },
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

const USER_ID = "user-1" as Id<"users">;

const MANUAL_2P_GAME: ActiveGame = {
    gameId: "g0" as Id<"games">,
    matchId: "m0" as Id<"matches">,
    name: "Tabletop table",
    status: "playing",
    matchStatus: "playing",
    solo: false,
    vsAi: false,
    mode: "manual",
};

/** A Bo3 sitting between Games: the current GAME row is finished, the MATCH is
 *  still active. Issue #3336's stranded state — reachable in production, and
 *  the one the banner used to offer `leaveGame` for. */
const BETWEEN_GAMES: ActiveGame = {
    gameId: "g1" as Id<"games">,
    matchId: "m1" as Id<"matches">,
    name: "Bo3 table",
    status: "finished",
    matchStatus: "sideboarding",
    solo: false,
    vsAi: false,
    mode: null,
};

describe("ActiveGameNotice — a finished Game under a live Match (issue #3336)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        forfeitMatch.mockResolvedValue(undefined);
        leaveGame.mockResolvedValue(undefined);
    });

    it("offers Concede Match, never Leave — `leaveGame` refuses a finished Game", () => {
        render(
            <ActiveGameNotice activeGame={BETWEEN_GAMES} userId={USER_ID} />
        );

        expect(screen.queryByText("Leave")).toBeNull();
        expect(screen.getByText("Concede Match")).toBeTruthy();
    });

    it("the offered button reaches a mutation the server accepts", async () => {
        render(
            <ActiveGameNotice activeGame={BETWEEN_GAMES} userId={USER_ID} />
        );

        fireEvent.click(screen.getByText("Concede Match"));
        await waitFor(() =>
            expect(screen.getByText("Concede match?")).toBeTruthy()
        );
        fireEvent.click(screen.getAllByText("Concede Match")[1]);

        await waitFor(() =>
            expect(forfeitMatch).toHaveBeenCalledWith({
                matchId: "m1",
                playerId: "user-1",
            })
        );
        // The whole stranding in one assertion: `leaveGame` throws
        // "Cannot leave a finished game" for this state, so the banner must
        // never call it.
        expect(leaveGame).not.toHaveBeenCalled();
    });

    it("does not describe a finished Game as waiting for an opponent", () => {
        render(
            <ActiveGameNotice activeGame={BETWEEN_GAMES} userId={USER_ID} />
        );

        expect(screen.queryByText(/waiting for an opponent/)).toBeNull();
        expect(screen.getByText(/between games/)).toBeTruthy();
    });

    it("still offers Leave for a waiting room, which `leaveGame` does accept", async () => {
        const waitingRoom: ActiveGame = {
            ...BETWEEN_GAMES,
            status: "waiting",
            matchStatus: "waiting",
        };
        render(<ActiveGameNotice activeGame={waitingRoom} userId={USER_ID} />);

        fireEvent.click(screen.getByText("Leave"));
        await waitFor(() =>
            expect(leaveGame).toHaveBeenCalledWith({ gameId: "g1" })
        );
        expect(screen.queryByText("Concede Match")).toBeNull();
    });
});

describe("ActiveGameNotice concede seat derivation (issue #2400, review round 2)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        forfeitMatch.mockResolvedValue(undefined);
        manualConcedeMatch.mockResolvedValue(undefined);
        leaveGame.mockResolvedValue(undefined);
    });

    it("concedes a 2-player manual (Tabletop) match with the bare user id, not the solo `-p1` seat", async () => {
        render(
            <ActiveGameNotice activeGame={MANUAL_2P_GAME} userId={USER_ID} />
        );

        fireEvent.click(screen.getByText("Concede Match"));
        await waitFor(() =>
            expect(screen.getByText("Concede match?")).toBeTruthy()
        );
        fireEvent.click(screen.getAllByText("Concede Match")[1]);

        await waitFor(() =>
            expect(manualConcedeMatch).toHaveBeenCalledWith({
                gameId: "g0",
                playerId: "user-1",
            })
        );
        // Proves the fix: before it, this call was hardcoded to `user-1-p1`,
        // which `computeForfeitMatch` rejects for a 2-player Match (seat not
        // found) — see the round-2 review's pure-transition probe.
        expect(manualConcedeMatch).not.toHaveBeenCalledWith(
            expect.objectContaining({ playerId: "user-1-p1" })
        );
    });

    it("still uses the solo `-p1` seat for a solo manual game", async () => {
        const soloManual: ActiveGame = { ...MANUAL_2P_GAME, solo: true };
        render(<ActiveGameNotice activeGame={soloManual} userId={USER_ID} />);

        fireEvent.click(screen.getByText("Concede Match"));
        await waitFor(() =>
            expect(screen.getByText("Concede match?")).toBeTruthy()
        );
        fireEvent.click(screen.getAllByText("Concede Match")[1]);

        await waitFor(() =>
            expect(manualConcedeMatch).toHaveBeenCalledWith({
                gameId: "g0",
                playerId: "user-1-p1",
            })
        );
    });

    it("dismisses the dialog after a successful manual concede (no unhandled rejection stalls it)", async () => {
        const soloManual: ActiveGame = { ...MANUAL_2P_GAME, solo: true };
        render(<ActiveGameNotice activeGame={soloManual} userId={USER_ID} />);

        fireEvent.click(screen.getByText("Concede Match"));
        await waitFor(() =>
            expect(screen.getByText("Concede match?")).toBeTruthy()
        );
        fireEvent.click(screen.getAllByText("Concede Match")[1]);

        await waitFor(() =>
            expect(screen.queryByText("Concede match?")).toBeNull()
        );
    });
});
