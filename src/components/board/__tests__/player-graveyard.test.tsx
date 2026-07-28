import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import PlayerGraveyard from "../player-graveyard";

const noopMinimized = {
    isMinimized: false,
    minimize: () => {},
    restore: () => {},
};

// Capture the props CardsPile receives so we can assert the eligibility
// allow-list reaches it (issue #933 parity — graveyard picks previously
// forwarded the ring to EVERY card because `eligibleIds` was computed but
// never passed to CardsPile).
const cardsPileSpy = vi.fn();
vi.mock("../cards-pile", () => ({
    default: (props: {
        cards: CardInstance[];
        layout?: "fan" | "grid";
        forceOpen?: boolean;
        selectedIds?: string[];
        eligibleIds?: ReadonlySet<string>;
        onCardClick?: (card: { id: string }) => void;
    }) => {
        cardsPileSpy(props);
        return <div data-testid="cards-pile" data-count={props.cards.length} />;
    },
}));

const selectTargetSpy = vi.fn();
vi.mock("convex/react", () => ({
    useMutation: () => selectTargetSpy,
}));

function makeCard(id: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        isTapped: false,
    };
}

function makePlayer(graveyard: CardInstance[]): Player {
    return {
        id: "me",
        name: "me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard,
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

function renderWithContext(
    ui: React.ReactElement,
    playerId = "me",
    extra: {
        pendingChoices?: NonNullable<
            React.ContextType<typeof GameContext>
        >["pendingChoices"];
        pendingTarget?: NonNullable<
            React.ContextType<typeof GameContext>
        >["pendingTarget"];
        buffer?: PendingChoiceBuffer;
    } = {}
) {
    const value = {
        gameId: "game-id" as never,
        playerId,
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
        pendingChoices: extra.pendingChoices,
        pendingTarget: extra.pendingTarget,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={extra.buffer ?? noopBuffer}>
                <MinimizedChoiceContext value={noopMinimized}>
                    {ui}
                </MinimizedChoiceContext>
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

describe("PlayerGraveyard", () => {
    it("gates the ring/click to candidateIds on a filtered graveyard pick (Exhume — creatures only)", () => {
        // A filtered `choose-graveyard-card` (Exhume: "a creature card") carries
        // `candidateIds`; only those cards are pickable. Clicking an ineligible
        // card is a no-op, AND the allow-list must reach CardsPile so it can dim
        // the non-matching cards and ring only the eligible ones.
        cardsPileSpy.mockClear();
        const graveyard = [makeCard("creature-1"), makeCard("land-2")];
        const player = makePlayer(graveyard);
        const toggle = vi.fn();
        renderWithContext(<PlayerGraveyard player={player} />, "me", {
            pendingChoices: [
                {
                    stackItemId: "stk",
                    step: 0,
                    choiceId: "exhume",
                    playerId: "me",
                    kind: "choose-graveyard-card",
                    zone: "graveyard",
                    count: 1,
                    candidateIds: ["creature-1"],
                    prompt: "Return a creature card from your graveyard.",
                },
            ],
            buffer: { ...noopBuffer, toggle },
        });
        const pileProps = cardsPileSpy.mock.calls.at(-1)?.[0];
        // Click handler gates to the allow-list.
        pileProps.onCardClick({ id: "land-2" }); // ineligible — no-op
        expect(toggle).not.toHaveBeenCalled();
        pileProps.onCardClick({ id: "creature-1" }); // eligible
        expect(toggle).toHaveBeenCalledWith("creature-1");
        // The allow-list itself must reach CardsPile so it can gate the per-card
        // ring/opacity, not just the click handler.
        expect(pileProps.eligibleIds).toBeInstanceOf(Set);
        expect(pileProps.eligibleIds.has("creature-1")).toBe(true);
        expect(pileProps.eligibleIds.has("land-2")).toBe(false);
        expect(pileProps.layout).toBe("grid");
        expect(pileProps.forceOpen).toBe(true);
        // The modal title must reflect the choice's own prompt — Exhume
        // reanimates to the battlefield, so a hardcoded "return to your hand"
        // default would mislabel it.
        expect(pileProps.title).toBe(
            "Return a creature card from your graveyard."
        );
    });

    it("titles the picker from the choice prompt (Exhume reanimates — not 'to your hand')", () => {
        cardsPileSpy.mockClear();
        const player = makePlayer([makeCard("creature-1")]);
        renderWithContext(<PlayerGraveyard player={player} />, "me", {
            pendingChoices: [
                {
                    stackItemId: "stk",
                    step: 0,
                    choiceId: "exhume",
                    playerId: "me",
                    kind: "choose-graveyard-card",
                    zone: "graveyard",
                    count: 1,
                    prompt: "Exhume: put a creature card from your graveyard onto the battlefield.",
                },
            ],
        });
        const pileProps = cardsPileSpy.mock.calls.at(-1)?.[0];
        expect(pileProps.title).toBe(
            "Exhume: put a creature card from your graveyard onto the battlefield."
        );
    });

    it("forwards no allow-list on an unfiltered graveyard pick (every card selectable)", () => {
        // Recall ("return a card from your graveyard") carries no `candidateIds`;
        // every card stays selectable, so no allow-list is forwarded.
        cardsPileSpy.mockClear();
        const player = makePlayer([makeCard("g1"), makeCard("g2")]);
        renderWithContext(<PlayerGraveyard player={player} />, "me", {
            pendingChoices: [
                {
                    stackItemId: "stk",
                    step: 0,
                    choiceId: "recall",
                    playerId: "me",
                    kind: "choose-graveyard-card",
                    zone: "graveyard",
                    count: 1,
                    prompt: "Return a card from your graveyard.",
                },
            ],
        });
        const pileProps = cardsPileSpy.mock.calls.at(-1)?.[0];
        expect(pileProps.eligibleIds).toBeUndefined();
        expect(pileProps.title).toBe("Return a card from your graveyard.");
    });
});

// Issue #1650 — Emry, Lurker of the Loch's "{T}: Choose target artifact card
// in your graveyard." is the first ACTIVATED ability whose target lives in a
// graveyard, so the pile's `selectTarget` routing (CR 601.2c) is now on a
// card's critical path. Asserted through the real component: a
// `zone: "graveyard"` + `controller: "you"` pending target makes the OWN
// pile's cards clickable and submits a `graveyard-card` selection, while the
// opponent's pile stays inert under the same pending target.
describe("PlayerGraveyard — graveyard-zone target routing (Emry, issue #1650)", () => {
    const emryPendingTarget = {
        playerId: "me",
        cardInstanceId: "emry",
        kind: "ability",
        abilityId: "emry-lurker-of-the-loch-graveyard-cast",
        targetType: "Artifact",
        zone: "graveyard",
        controller: "you",
        count: 1,
        selected: [],
    } as unknown as NonNullable<
        React.ContextType<typeof GameContext>
    >["pendingTarget"];

    it("clicking a card in YOUR graveyard submits a graveyard-card selection", () => {
        cardsPileSpy.mockClear();
        selectTargetSpy.mockClear();
        const player = makePlayer([makeCard("gy-artifact")]);
        renderWithContext(<PlayerGraveyard player={player} />, "me", {
            pendingTarget: emryPendingTarget,
        });
        const pileProps = cardsPileSpy.mock.calls.at(-1)?.[0];
        expect(pileProps.onCardClick).toBeTypeOf("function");
        pileProps.onCardClick({ id: "gy-artifact" });
        expect(selectTargetSpy).toHaveBeenCalledTimes(1);
        expect(selectTargetSpy.mock.calls[0][0]).toMatchObject({
            playerId: "me",
            targetType: "graveyard-card",
            targetId: "gy-artifact",
            targetPlayerId: "me",
        });
    });

    it("leaves the OPPONENT's graveyard inert under a controller: 'you' requirement", () => {
        cardsPileSpy.mockClear();
        selectTargetSpy.mockClear();
        const theirs = {
            ...makePlayer([makeCard("their-artifact")]),
            id: "opp",
        };
        renderWithContext(<PlayerGraveyard player={theirs} />, "me", {
            pendingTarget: emryPendingTarget,
        });
        const pileProps = cardsPileSpy.mock.calls.at(-1)?.[0];
        expect(pileProps.onCardClick).toBeUndefined();
        expect(selectTargetSpy).not.toHaveBeenCalled();
    });
});
