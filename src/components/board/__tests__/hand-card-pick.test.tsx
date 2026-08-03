import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import HandCardPick from "../hand-card-pick";

const noopMinimized = {
    isMinimized: false,
    minimize: () => {},
    restore: () => {},
};

// Capture the props CardsPile receives so we can assert the picker shape without
// rendering the real modal. LibrarySearchConfirm (the footer) is a plain node.
const cardsPileSpy = vi.fn();
vi.mock("../cards-pile", () => ({
    default: (props: {
        cards: CardInstance[];
        forceOpen?: boolean;
        layout?: "fan" | "grid";
        selectedIds?: string[];
        eligibleIds?: ReadonlySet<string>;
        onCardClick?: (card: { id: string }) => void;
    }) => {
        cardsPileSpy(props);
        return <div data-testid="cards-pile" data-count={props.cards.length} />;
    },
}));
vi.mock("../library-search-confirm", () => ({
    default: () => <div data-testid="confirm" />,
}));

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

type Choices = NonNullable<
    React.ContextType<typeof GameContext>
>["pendingChoices"];

function renderWith(opts: {
    playerId?: string;
    allPlayers: Player[];
    pendingChoices?: Choices;
    buffer?: PendingChoiceBuffer;
}) {
    const value = {
        gameId: "game-id" as never,
        playerId: opts.playerId ?? "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: opts.allPlayers,
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
        pendingChoices: opts.pendingChoices,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={opts.buffer ?? noopBuffer}>
                <MinimizedChoiceContext value={noopMinimized}>
                    <HandCardPick />
                </MinimizedChoiceContext>
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

// Thoughtseize-shaped choice: controller ("me") picks a nonland from the
// target ("opp") revealed hand (CR 608.2). candidateIds = the nonland ids.
function thoughtseizeChoice(): Choices {
    return [
        {
            stackItemId: "s1",
            step: 0,
            choiceId: "c0",
            playerId: "me",
            kind: "choose-hand-card",
            zone: "hand",
            zoneOwnerId: "opp",
            count: 1,
            candidateIds: ["c1"],
            prompt: "Choose a nonland card from that player's hand.",
        },
    ] as Choices;
}

describe("HandCardPick (Thoughtseize opponent-hand pick, CR 608.2)", () => {
    it("opens the picker over the revealed opponent hand with the nonland allow-list", () => {
        cardsPileSpy.mockClear();
        const opp = makePlayer("opp", [
            makeCard("c1", "opp"), // nonland — eligible
            makeCard("c2", "opp"), // land — shown but dimmed/inert
        ]);
        renderWith({
            allPlayers: [makePlayer("me", []), opp],
            pendingChoices: thoughtseizeChoice(),
        });
        const props = cardsPileSpy.mock.calls.at(-1)?.[0];
        expect(props.forceOpen).toBe(true);
        expect(props.layout).toBe("grid");
        // Whole revealed hand is shown; only the nonland is selectable.
        expect(props.cards.map((c: CardInstance) => c.id)).toEqual([
            "c1",
            "c2",
        ]);
        expect([...props.eligibleIds]).toEqual(["c1"]);
    });

    it("toggles the buffer for an eligible pick and ignores an ineligible one", () => {
        cardsPileSpy.mockClear();
        const toggle = vi.fn();
        const opp = makePlayer("opp", [
            makeCard("c1", "opp"),
            makeCard("c2", "opp"),
        ]);
        renderWith({
            allPlayers: [makePlayer("me", []), opp],
            pendingChoices: thoughtseizeChoice(),
            buffer: { ...noopBuffer, toggle },
        });
        const onCardClick = cardsPileSpy.mock.calls.at(-1)?.[0].onCardClick;
        onCardClick({ id: "c2" }); // land — not in candidateIds → no-op
        expect(toggle).not.toHaveBeenCalled();
        onCardClick({ id: "c1" }); // nonland — toggles
        expect(toggle).toHaveBeenCalledWith("c1");
    });

    it("renders nothing for an own-hand choose-hand-card pick (zoneOwnerId === viewer)", () => {
        cardsPileSpy.mockClear();
        const choices = thoughtseizeChoice();
        choices![0] = { ...choices![0], zoneOwnerId: "me" };
        const { queryByTestId } = renderWith({
            allPlayers: [makePlayer("me", [makeCard("h1", "me")])],
            pendingChoices: choices,
        });
        expect(queryByTestId("cards-pile")).toBeNull();
    });

    it("renders nothing when there is no active hand-card choice", () => {
        cardsPileSpy.mockClear();
        const { queryByTestId } = renderWith({
            allPlayers: [makePlayer("me", []), makePlayer("opp", [])],
            pendingChoices: undefined,
        });
        expect(queryByTestId("cards-pile")).toBeNull();
    });
});

// The eligibility ring alone left the chooser scanning a seven-card grid for
// the two legal picks (Inquisition of Kozilek's "nonland card with mana value
// 3 or less"). Filtered picks front-load the legal set, exactly like the
// filtered library search.
describe("HandCardPick orders eligible cards first", () => {
    it("hoists the allow-listed cards to the front of the pile", () => {
        cardsPileSpy.mockClear();
        const opp = makePlayer("opp", [
            makeCard("land-1", "opp"),
            makeCard("land-2", "opp"),
            makeCard("c1", "opp"), // the only eligible pick
            makeCard("land-3", "opp"),
        ]);
        renderWith({
            allPlayers: [makePlayer("me", []), opp],
            pendingChoices: thoughtseizeChoice(),
        });
        const props = cardsPileSpy.mock.calls.at(-1)?.[0];
        expect(props.cards[0].id).toBe("c1");
        // Nothing is dropped — the whole hand is still shown.
        expect(props.cards).toHaveLength(4);
    });
});

// Regression (#1719 review finding 1) — the #1698 fix keyed on
// `kind === "choose-hand-card"` and missed the IDENTICAL cross-player shape
// under `kind: "discard-hand"` (Mind Warp, Leshrac's Sigil: the caster picks
// which of the TARGET's cards get discarded), leaving both cards hung with
// no reachable UI (no modal AND the in-hand toggle can't help — the picked-
// from cards aren't the chooser's own). The router now keys on
// "chooser ≠ zone owner", not `kind`.
function mindWarpShapedChoice(): Choices {
    return [
        {
            stackItemId: "s1",
            step: 0,
            choiceId: "c0",
            playerId: "me",
            kind: "discard-hand",
            zone: "hand",
            zoneOwnerId: "opp",
            count: 1,
            prompt: "Mind Warp: choose cards for that player to discard.",
        },
    ] as Choices;
}

describe("HandCardPick (Mind Warp/Leshrac's Sigil opponent-hand pick, discard-hand kind, #1719)", () => {
    it("opens the picker for a cross-player discard-hand pick", () => {
        cardsPileSpy.mockClear();
        const opp = makePlayer("opp", [
            makeCard("c1", "opp"),
            makeCard("c2", "opp"),
        ]);
        renderWith({
            allPlayers: [makePlayer("me", []), opp],
            pendingChoices: mindWarpShapedChoice(),
        });
        const props = cardsPileSpy.mock.calls.at(-1)?.[0];
        expect(props.forceOpen).toBe(true);
        expect(props.cards.map((c: CardInstance) => c.id)).toEqual([
            "c1",
            "c2",
        ]);
    });

    it("toggles the buffer on a discard-hand pick click", () => {
        cardsPileSpy.mockClear();
        const toggle = vi.fn();
        const opp = makePlayer("opp", [makeCard("c1", "opp")]);
        renderWith({
            allPlayers: [makePlayer("me", []), opp],
            pendingChoices: mindWarpShapedChoice(),
            buffer: { ...noopBuffer, toggle },
        });
        const onCardClick = cardsPileSpy.mock.calls.at(-1)?.[0].onCardClick;
        onCardClick({ id: "c1" });
        expect(toggle).toHaveBeenCalledWith("c1");
    });

    it("renders nothing for an own-hand discard-hand pick (zoneOwnerId === viewer, e.g. cleanup discard)", () => {
        cardsPileSpy.mockClear();
        const choices = mindWarpShapedChoice();
        choices![0] = { ...choices![0], zoneOwnerId: "me" };
        const { queryByTestId } = renderWith({
            allPlayers: [makePlayer("me", [makeCard("h1", "me")])],
            pendingChoices: choices,
        });
        expect(queryByTestId("cards-pile")).toBeNull();
    });

    it("renders nothing for a reveal-hand pick even with a cross-player zoneOwnerId (RevealHandView owns that kind)", () => {
        cardsPileSpy.mockClear();
        const choices = mindWarpShapedChoice();
        choices![0] = { ...choices![0], kind: "reveal-hand" };
        const opp = makePlayer("opp", [makeCard("c1", "opp")]);
        const { queryByTestId } = renderWith({
            allPlayers: [makePlayer("me", []), opp],
            pendingChoices: choices,
        });
        expect(queryByTestId("cards-pile")).toBeNull();
    });
});
