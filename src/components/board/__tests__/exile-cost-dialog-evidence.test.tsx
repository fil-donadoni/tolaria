// CR 701.59a — `ExileCostDialog`'s collect evidence mode (issue #7723): any
// number of the activator's own cards whose total mana value reaches N, priced by
// the helpers the server validates with. The choice comes through the real
// projection (`projectPublicState`), so a reducer dropping the threshold reds.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import type { GameState } from "@convex/gre/state";
import type { Player } from "~/types/game";

const submitted: unknown[] = [];
vi.mock("convex/react", () => ({
    useMutation: () => async (args: unknown) => {
        submitted.push(args);
    },
}));
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));

import ExileCostDialog from "../exile-cost-dialog";

function projected(names: [string, string][]) {
    const graveyard = names.map(([name, id]) =>
        makeInstance(getCardByName(name).id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        })
    );
    const state = makeState({
        players: [makePlayer("p1", { graveyard }), makePlayer("p2")],
        pendingActivation: {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "a",
            manaCost: {},
            tappedLandIds: [],
            exileFromGraveyardChoice: {
                count: 1,
                owner: "you",
                minTotalManaValue: 3,
            },
        } as unknown as GameState["pendingActivation"],
    });
    const wire = projectPublicState(state, 1, "p1");
    return {
        choice: wire.pendingActivation!.exileFromGraveyardChoice!,
        allPlayers: wire.players as unknown as Player[],
    };
}

describe("ExileCostDialog — collect evidence mode (CR 701.59a)", () => {
    beforeEach(() => {
        cleanup();
        submitted.length = 0;
    });

    it("blocks confirming under the threshold, takes more than one card, and submits once reached", () => {
        const { choice, allPlayers } = projected([
            ["Grizzly Bears", "bears"],
            ["Lightning Bolt", "bolt"],
        ]);
        render(
            <ExileCostDialog
                choice={choice}
                allPlayers={allPlayers}
                gameId={"g" as never}
                playerId="p1"
            />
        );
        expect(screen.getByText("Collect evidence")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: /Grizzly Bears/ }));
        const short = screen.getByRole("button", { name: /mana value 2\/3/ });
        expect((short as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole("button", { name: /Lightning Bolt/ }));
        const ok = screen.getByRole("button", { name: /mana value 3\/3/ });
        expect((ok as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(ok);
        expect(submitted).toEqual([
            {
                gameId: "g",
                playerId: "p1",
                graveyardOwnerId: "p1",
                cardInstanceIds: ["bears", "bolt"],
            },
        ]);
    });

    it("offers no graveyard that cannot reach the threshold (CR 701.59b)", () => {
        const { choice, allPlayers } = projected([["Lightning Bolt", "bolt"]]);
        render(
            <ExileCostDialog
                choice={choice}
                allPlayers={allPlayers}
                gameId={"g" as never}
                playerId="p1"
            />
        );
        expect(screen.queryAllByTestId("card-image")).toHaveLength(0);
    });
});
