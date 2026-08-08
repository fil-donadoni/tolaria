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
    solo: false,
    vsAi: false,
    mode: "manual",
};

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
