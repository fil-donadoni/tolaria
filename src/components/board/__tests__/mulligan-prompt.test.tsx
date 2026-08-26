// Pre-game mulligan prompt (CR 103.5, London mulligan). No dom test existed
// before issue #2730's v4 re-skin (`Panel` + `font-beleren` → the chrome
// display face) — this covers the declarer/waiting branches and pins the
// display-face title so a future revert back to Beleren (ADR 0103 §4:
// Beleren confined to the card domain) is caught here.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import type { MulliganState, Player } from "~/types/game";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const declareMulligan = vi.fn<MutFn>(() => Promise.resolve());

vi.mock("convex/react", () => ({
    useMutation: () => declareMulligan,
    useQuery: () => undefined,
}));

vi.mock("@convex/_generated/api", () => ({
    api: { game: { declareMulligan: { _name: "declareMulligan" } } },
}));

import MulliganPrompt from "../mulligan-prompt";

afterEach(cleanup);

function player(over: Partial<Player> = {}): Player {
    return {
        id: "me",
        name: "Me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...over,
    };
}

function mulligan(over: Partial<MulliganState> = {}): MulliganState {
    return {
        mulligansTaken: [0, 0],
        declarations: [null, null],
        locked: [false, false],
        declaringPlayerId: "me",
        bottoming: false,
        ...over,
    };
}

describe("MulliganPrompt (CR 103.5)", () => {
    it("shows the display-face title for the declaring player, not the retired Beleren card face", () => {
        render(
            <MulliganPrompt
                gameId={"g1" as Id<"games">}
                viewerId="me"
                mulligan={mulligan()}
                allPlayers={[player(), player({ id: "opp", name: "Opp" })]}
            />
        );
        const title = screen.getByText("Mulligan");
        expect(title.className).toContain("text-display");
        expect(title.className).not.toContain("font-beleren");
    });

    it("lets the declaring player Keep, invoking declareMulligan", () => {
        render(
            <MulliganPrompt
                gameId={"g1" as Id<"games">}
                viewerId="me"
                mulligan={mulligan()}
                allPlayers={[player(), player({ id: "opp", name: "Opp" })]}
            />
        );
        fireEvent.click(screen.getByText("Keep"));
        expect(declareMulligan).toHaveBeenCalledWith({
            gameId: "g1",
            playerId: "me",
            decision: "keep",
        });
    });

    it("shows a waiting line naming the declaring opponent, not Beleren", () => {
        render(
            <MulliganPrompt
                gameId={"g1" as Id<"games">}
                viewerId="me"
                mulligan={mulligan({ declaringPlayerId: "opp" })}
                allPlayers={[player(), player({ id: "opp", name: "Opp" })]}
            />
        );
        const name = screen.getByText("Opp");
        expect(name.className).toContain("text-display");
        expect(name.className).not.toContain("font-beleren");
    });
});
