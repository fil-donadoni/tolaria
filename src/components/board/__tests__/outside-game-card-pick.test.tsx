// The Wish pick's client surface (CR 400.11b, issue #6523), fed from the REAL
// wire: a GRE state with the `bringFromOutsideGame` pick pending, projected by
// `projectPublicState` for each seat, rendered by `OutsideGameCardPick`. A
// hand-built view would prove nothing about what the client receives.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName } from "@convex/cards";
import { withTemporaryDefinition } from "@convex/cards/registry";
import type { CardDefinition } from "@convex/cards/types";
import { resolveTopOfStack } from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import OutsideGameCardPick from "../outside-game-card-pick";
import { publicStateDefinitionIds } from "~/lib/publicStateDefinitionIds";

const cardsPileSpy = vi.fn();
vi.mock("../cards-pile", () => ({
    default: (props: {
        cards: CardInstance[];
        forceOpen?: boolean;
        onCardClick?: (card: { id: string }) => void;
    }) => {
        cardsPileSpy(props);
        return <div data-testid="cards-pile" data-count={props.cards.length} />;
    },
}));
vi.mock("../library-search-confirm", () => ({
    default: () => <div data-testid="confirm" />,
}));

const MIND_TWIST = getCardByName("Mind Twist").id;
const CRAW_WURM = getCardByName("Craw Wurm").id;

const WISH: CardDefinition = {
    id: "t6523-ui-wish",
    name: "t6523-ui-wish",
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "bringFromOutsideGame",
            player: "controller",
            filter: { type: "Sorcery" },
            prompt: "Reveal a sorcery card you own from outside the game.",
        },
    ],
};

/** p1 cast the wish; its pick is head-of-queue. Projected for `viewer`. */
function wire(viewer: string, chooser = "p1") {
    return withTemporaryDefinition(WISH, () => {
        const outside = (defId: string, id: string) =>
            makeInstance(defId, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "exile",
            });
        const state = makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    outsideGame: [
                        outside(MIND_TWIST, "sb-twist"),
                        outside(CRAW_WURM, "sb-wurm"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, WISH.id, "p1");
        resolveTopOfStack(state);
        // A controlled cast (ADR 0037) routes the pick to the other seat; the
        // pool stays p1's.
        if (chooser !== "p1") {
            const head = state.pendingChoices![0]!;
            state.pendingChoices = [
                { ...head, playerId: chooser, zoneOwnerId: "p1" },
            ];
        }
        return projectPublicState(state, 1, viewer);
    });
}

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: async () => {},
    isPending: false,
    lastError: null,
    reportError: () => {},
    dismissError: () => {},
};

function renderFor(viewer: string, buffer: PendingChoiceBuffer = noopBuffer) {
    const projected = wire(viewer);
    const value = {
        gameId: "game-id" as never,
        playerId: viewer,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 1,
        stackItems: [],
        allPlayers: projected.players as unknown as Player[],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
        pendingChoices: projected.pendingChoices,
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={buffer}>
                <MinimizedChoiceContext
                    value={{
                        isMinimized: false,
                        minimize: () => {},
                        restore: () => {},
                    }}
                >
                    <OutsideGameCardPick />
                </MinimizedChoiceContext>
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

describe("OutsideGameCardPick — the Wish pick (CR 400.11b)", () => {
    it("opens for the chooser over exactly the matching cards it owns", () => {
        cardsPileSpy.mockClear();
        renderFor("p1");
        const props = cardsPileSpy.mock.calls.at(-1)?.[0];
        expect(props.forceOpen).toBe(true);
        expect(
            props.cards.map((c: CardInstance) => (c.card as { id: string }).id)
        ).toEqual([MIND_TWIST]);
    });

    it("a click buffers the card", () => {
        cardsPileSpy.mockClear();
        const toggle = vi.fn();
        renderFor("p1", { ...noopBuffer, toggle });
        cardsPileSpy.mock.calls.at(-1)?.[0].onCardClick({ id: "sb-twist" });
        expect(toggle).toHaveBeenCalledWith("sb-twist");
    });

    it("renders nothing for the opponent", () => {
        cardsPileSpy.mockClear();
        const { queryByTestId } = renderFor("p2");
        expect(queryByTestId("cards-pile")).toBeNull();
    });
});

describe("the board loads the picker's definitions (useDefinitionsResident)", () => {
    it("walks the chooser's holder and the pick's candidates", () => {
        const ids = publicStateDefinitionIds(
            wire("p1") as unknown as Parameters<
                typeof publicStateDefinitionIds
            >[0]
        );
        expect(ids).toContain(MIND_TWIST);
        expect(ids).toContain(CRAW_WURM);
        const oppIds = publicStateDefinitionIds(
            wire("p2") as unknown as Parameters<
                typeof publicStateDefinitionIds
            >[0]
        );
        expect(oppIds).not.toContain(MIND_TWIST);
    });

    it("a chooser picking from ANOTHER seat's pool loads the candidates it is shown", () => {
        const ids = publicStateDefinitionIds(
            wire("p2", "p2") as unknown as Parameters<
                typeof publicStateDefinitionIds
            >[0]
        );
        expect(ids).toContain(MIND_TWIST);
        // Only the candidates — never the rest of p1's holder.
        expect(ids).not.toContain(CRAW_WURM);
    });
});
