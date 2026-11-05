// CR 702.132a — Assist's first step: the caster names another player or no one,
// and dismissing cancels the cast like every other cast picker.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import type { AssistChoice, Player } from "~/types/game";

const selectAssistPlayer = vi.fn(() => Promise.resolve());
const cancelCast = vi.fn(() => Promise.resolve());

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "selectAssistPlayer" ? selectAssistPlayer : cancelCast,
}));

vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            selectAssistPlayer: { _name: "selectAssistPlayer" },
            cancelCast: { _name: "cancelCast" },
        },
    },
}));

import AssistPlayerDialog from "../assist-player-dialog";

const CHOICE: AssistChoice = {
    stage: "choose-player",
    candidateIds: ["opp"],
    spell: {
        spellCardId: "spell",
        spellName: "Magma Hellion",
        spellTypes: ["Creature"],
        spellSupertypes: [],
    },
};

function renderDialog() {
    render(
        <AssistPlayerDialog
            choice={CHOICE}
            allPlayers={[{ id: "opp", name: "Rival" } as Player]}
            gameId={"game" as never}
            playerId="me"
        />
    );
}

describe("AssistPlayerDialog", () => {
    beforeEach(() => {
        selectAssistPlayer.mockClear();
        cancelCast.mockClear();
    });
    afterEach(cleanup);

    it("names the candidate by their display name and submits their id", async () => {
        renderDialog();
        expect(screen.getByText("Assist Magma Hellion")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Ask Rival" }));
        await waitFor(() =>
            expect(selectAssistPlayer).toHaveBeenCalledWith({
                gameId: "game",
                playerId: "me",
                assistPlayerId: "opp",
            })
        );
    });

    it("declining names no one", async () => {
        renderDialog();
        fireEvent.click(
            screen.getByRole("button", { name: "Pay it yourself" })
        );
        await waitFor(() =>
            expect(selectAssistPlayer).toHaveBeenCalledWith({
                gameId: "game",
                playerId: "me",
            })
        );
        expect(cancelCast).not.toHaveBeenCalled();
    });
});
