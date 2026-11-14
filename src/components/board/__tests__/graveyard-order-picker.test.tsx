import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

// CR 404.3 (issue #9554) — the board mount of the graveyard arrangement.
// Captures the mutation spy + the LibraryOrderPicker props, like
// `put-back-picker.test.tsx`.
const { submitSpy, pickerSpy } = vi.hoisted(() => ({
    submitSpy: vi.fn(),
    pickerSpy: vi.fn(),
}));
vi.mock("convex/react", () => ({ useMutation: () => submitSpy }));
vi.mock("@convex/_generated/api", () => ({
    api: { game: { submitResolutionChoice: "submitResolutionChoice" } },
}));
vi.mock("../library-order/library-order-picker", () => ({
    default: (props: unknown) => {
        pickerSpy(props);
        return <div data-testid="picker" />;
    },
}));

import GraveyardOrderPicker from "../graveyard-order-picker";

function card(id: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        isTapped: false,
    };
}

function player(id: string, graveyard: CardInstance[]): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard,
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

type Choices = NonNullable<
    React.ContextType<typeof GameContext>
>["pendingChoices"];

function choice(playerId: string): Choices {
    return [
        {
            stackItemId: "",
            step: 0,
            choiceId: "graveyard-order-c-b",
            playerId,
            zoneOwnerId: playerId,
            kind: "graveyard-order",
            zone: "graveyard",
            count: 2,
            candidateIds: ["c", "b"],
        },
    ];
}

function renderWith(pendingChoices: Choices) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [
            player("me", [card("a"), card("b"), card("c")]),
            player("opp", []),
        ],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
        pendingChoices,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <GraveyardOrderPicker />
        </GameContext>
    );
}

type PickerProps = {
    lookedAt: { instanceId: string; defId: string }[];
    destination: string;
    graveyardOrder?: { onOrderRandomly: () => void };
    onConfirm: (top: string[], second: string[]) => void;
};

describe("GraveyardOrderPicker (CR 404.3)", () => {
    it("mounts the strip over the batch only, topmost first, in graveyardOrder mode", () => {
        pickerSpy.mockClear();
        renderWith(choice("me"));
        const props = pickerSpy.mock.calls.at(-1)?.[0] as PickerProps;
        expect(props.lookedAt).toEqual([
            { instanceId: "c", defId: "def-c" },
            { instanceId: "b", defId: "def-b" },
        ]);
        expect(props.destination).toBe("none");
        expect(props.graveyardOrder).toBeDefined();
    });

    it("Done submits the order topmost first; Order randomly asks the server", () => {
        pickerSpy.mockClear();
        submitSpy.mockClear();
        renderWith(choice("me"));
        const props = pickerSpy.mock.calls.at(-1)?.[0] as PickerProps;
        props.onConfirm(["b", "c"], []);
        expect(submitSpy).toHaveBeenLastCalledWith(
            expect.objectContaining({
                stackItemId: "",
                choiceId: "graveyard-order-c-b",
                cardInstanceIds: ["b", "c"],
            })
        );
        expect(submitSpy.mock.calls.at(-1)?.[0]).not.toHaveProperty(
            "orderRandomly"
        );
    });

    it("Order randomly submits orderRandomly, no client-side order", async () => {
        pickerSpy.mockClear();
        submitSpy.mockClear();
        renderWith(choice("me"));
        const props = pickerSpy.mock.calls.at(-1)?.[0] as PickerProps;
        props.graveyardOrder!.onOrderRandomly();
        await Promise.resolve();
        expect(submitSpy).toHaveBeenLastCalledWith(
            expect.objectContaining({
                cardInstanceIds: [],
                orderRandomly: true,
            })
        );
    });

    it("renders nothing for the player who is not arranging", () => {
        pickerSpy.mockClear();
        renderWith(choice("opp"));
        expect(pickerSpy).not.toHaveBeenCalled();
    });
});
