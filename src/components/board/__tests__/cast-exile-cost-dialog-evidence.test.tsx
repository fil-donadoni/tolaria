// Collect evidence GY-picker SURFACE test (CR 701.59a — issue #2074,
// Detective's Phoenix's "Bestow—{R}, Collect evidence 6").
//
// Mandatory per `.claude/rules/gre-development.md` § Frontend wiring analysis:
// the state is a real `GameState` with a parked collect-evidence `pendingCast`,
// pushed through `projectPublicState` — the wire shape the board hands
// `<CastExileCostDialog>`. A hand-built view would mask a dropped
// `minTotalManaValue`, the field the mode switches on.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Player } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import type { PendingCast } from "@convex/gre/state";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";

const submitted: unknown[] = [];
vi.mock("convex/react", () => ({
    useMutation: () => (args: unknown) => {
        submitted.push(args);
        return Promise.resolve();
    },
}));
vi.mock("@convex/_generated/api", () => ({
    api: { game: { selectCastExileCost: {}, cancelCast: {} } },
}));
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));

import CastExileCostDialog from "../cast-exile-cost-dialog";

/** Detective's Phoenix in the graveyard, parked on collect evidence 6, with
 *  Hill Giant (4) + Grizzly Bears (2) + Lightning Bolt (1) beside it. */
function projectedEvidenceCast() {
    const card = (name: string, id: string) =>
        makeInstance(getCardByName(name).id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
    const graveyard = [
        card("Detective's Phoenix", "phoenix"),
        card("Hill Giant", "giant"),
        card("Grizzly Bears", "bears"),
        card("Lightning Bolt", "bolt"),
    ];
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "phoenix",
        manaCost: { R: 1 },
        tappedLandIds: [],
        exileFromGraveyardChoice: {
            count: 1,
            minTotalManaValue: 6,
            excludeInstanceId: "phoenix",
        },
    };
    const state = makeState({
        players: [makePlayer("p1", { graveyard }), makePlayer("p2")],
        pendingCast,
    });
    const projected = projectPublicState(state, 1, "p1");
    return {
        choice: projected.pendingCast!.exileFromGraveyardChoice!,
        me: projected.players.find((p) => p.id === "p1") as unknown as Player,
    };
}

describe("CastExileCostDialog — collect evidence mode (CR 701.59a)", () => {
    beforeEach(() => {
        cleanup();
        submitted.length = 0;
    });

    it("survives the projection and renders as a Collect evidence picker without the Phoenix", () => {
        const { choice, me } = projectedEvidenceCast();
        expect(choice.minTotalManaValue).toBe(6);
        render(
            <CastExileCostDialog
                choice={choice}
                me={me}
                gameId={"g" as never}
                playerId="p1"
            />
        );
        expect(screen.getByText("Collect evidence")).toBeTruthy();
        // CR 601.2a — the Phoenix never pays its own cost.
        expect(screen.getAllByTestId("card-image")).toHaveLength(3);
    });

    it("blocks confirming under total mana value 6 and submits once it is reached", () => {
        const { choice, me } = projectedEvidenceCast();
        render(
            <CastExileCostDialog
                choice={choice}
                me={me}
                gameId={"g" as never}
                playerId="p1"
            />
        );
        fireEvent.click(screen.getByRole("button", { name: /Hill Giant/ }));
        fireEvent.click(screen.getByRole("button", { name: /Lightning Bolt/ }));
        const short = screen.getByRole("button", {
            name: /mana value 5\/6/,
        });
        expect((short as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole("button", { name: /Grizzly Bears/ }));
        const ok = screen.getByRole("button", { name: /mana value 7\/6/ });
        expect((ok as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(ok);
        expect(submitted).toEqual([
            {
                gameId: "g",
                playerId: "p1",
                cardInstanceIds: ["giant", "bolt", "bears"],
            },
        ]);
    });
});
