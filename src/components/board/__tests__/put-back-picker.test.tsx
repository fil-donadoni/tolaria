import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

// Capture the mutation spy + the LibraryOrderPicker props (esp. onConfirm) so we
// can assert the mount shape and the submit inversion without the real modal.
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

import PutBackPicker from "../put-back-picker";

function makeCard(id: string, ownerId: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: ownerId,
        ownerId,
        zone: "hand",
        isTapped: false,
    };
}

function makePlayer(id: string, hand: (CardInstance | null)[]): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand,
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

type Choices = NonNullable<
    React.ContextType<typeof GameContext>
>["pendingChoices"];

function renderWith(opts: { allPlayers: Player[]; pendingChoices?: Choices }) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: opts.allPlayers,
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
        pendingChoices: opts.pendingChoices,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PutBackPicker />
        </GameContext>
    );
}

// Brainstorm-shaped choice: own-hand choose-hand-card, count 2, putOnTop.
function putBackChoice(): Choices {
    return [
        {
            stackItemId: "s1",
            step: 0,
            choiceId: "put-back",
            playerId: "me",
            kind: "choose-hand-card",
            zone: "hand",
            count: 2,
            putOnTop: true,
            prompt: "Put two cards on top of your library.",
        },
    ] as Choices;
}

describe("PutBackPicker (Brainstorm put-back, CR 401.4)", () => {
    it("mounts the ordered picker over the whole own hand in putBack mode", () => {
        pickerSpy.mockClear();
        renderWith({
            allPlayers: [
                makePlayer("me", [
                    makeCard("h1", "me"),
                    makeCard("h2", "me"),
                    makeCard("h3", "me"),
                ]),
            ],
            pendingChoices: putBackChoice(),
        });
        const props = pickerSpy.mock.calls.at(-1)?.[0] as {
            lookedAt: { instanceId: string; defId: string }[];
            putBack?: { keep: number; min?: number };
        };
        // Brainstorm's put-back is EXACT: min === keep === 2.
        expect(props.putBack).toEqual({ keep: 2, min: 2 });
        expect(props.lookedAt).toEqual([
            { instanceId: "h1", defId: "def-h1" },
            { instanceId: "h2", defId: "def-h2" },
            { instanceId: "h3", defId: "def-h3" },
        ]);
    });

    it("submits the picks REVERSED (picker is topmost-first, the engine unshifts so the last id lands on top)", async () => {
        pickerSpy.mockClear();
        submitSpy.mockClear();
        renderWith({
            allPlayers: [
                makePlayer("me", [makeCard("h1", "me"), makeCard("h3", "me")]),
            ],
            pendingChoices: putBackChoice(),
        });
        const onConfirm = (
            pickerSpy.mock.calls.at(-1)?.[0] as {
                onConfirm: (top: string[]) => Promise<void>;
            }
        ).onConfirm;
        // Picker yields TOPMOST-FIRST: h3 on top, then h1.
        await onConfirm(["h3", "h1"]);
        expect(submitSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                stackItemId: "s1",
                step: 0,
                choiceId: "put-back",
                // Reversed → the engine's unshift loop puts h3 on top last.
                cardInstanceIds: ["h1", "h3"],
            })
        );
    });

    it("narrows the pool to `candidateIds` and honours a ranged count (Sylvan Library, issue #1691)", () => {
        pickerSpy.mockClear();
        const choices = putBackChoice();
        choices![0] = {
            ...choices![0],
            choiceId: "ranged-topdeck",
            count: { min: 0, max: 2 },
            candidateIds: ["h1", "h3"],
        };
        renderWith({
            allPlayers: [
                makePlayer("me", [
                    makeCard("h1", "me"),
                    makeCard("h2", "me"),
                    makeCard("h3", "me"),
                ]),
            ],
            pendingChoices: choices,
        });
        const props = pickerSpy.mock.calls.at(-1)?.[0] as {
            lookedAt: { instanceId: string }[];
            putBack?: { keep: number; min?: number };
        };
        // h2 is not in the allow-list → not selectable.
        expect(props.lookedAt.map((c) => c.instanceId)).toEqual(["h1", "h3"]);
        expect(props.putBack).toEqual({ keep: 2, min: 0 });
    });

    it("renders nothing for a plain own-hand pick without putOnTop", () => {
        pickerSpy.mockClear();
        const choices = putBackChoice();
        choices![0] = { ...choices![0], putOnTop: undefined };
        const { queryByTestId } = renderWith({
            allPlayers: [makePlayer("me", [makeCard("h1", "me")])],
            pendingChoices: choices,
        });
        expect(queryByTestId("picker")).toBeNull();
    });

    it("renders nothing when there is no active choice", () => {
        pickerSpy.mockClear();
        const { queryByTestId } = renderWith({
            allPlayers: [makePlayer("me", [])],
            pendingChoices: undefined,
        });
        expect(queryByTestId("picker")).toBeNull();
    });
});
