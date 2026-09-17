// ADR 0094 (issue #2264) — the multi-select half of the hand/graveyard cast
// pipeline: a mode list declaring a conditional `ModeSelection` is sized from
// the viewer's board BEFORE `announceCast` is called, the picker commits
// nothing until Confirm, and the dispatched ids are in printed order.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: () => Promise.resolve(),
    isPending: false,
    lastError: null,
    reportError: () => {},
    dismissError: () => {},
};

const playCard = vi.fn();
const announceCast = vi.fn();
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "playCard" ? playCard : announceCast,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            playCard: { _name: "playCard" },
            announceCast: { _name: "announceCast" },
        },
    },
}));
const MODES = [
    { id: "one", label: "Mode one", oracleText: "Mode one." },
    { id: "two", label: "Mode two", oracleText: "Mode two." },
    { id: "three", label: "Mode three", oracleText: "Mode three." },
];
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) => mockInstanceManaCost(c),
    getDefinition: () => ({
        name: "Conditional Charm",
        types: ["Instant"],
        manaCost: { R: 1 },
        modes: MODES,
        // "Choose one. You may choose two instead if you control a Wizard."
        modeSelection: {
            min: 1,
            max: 1,
            when: {
                condition: { controls: { subtypes: ["Wizard"] } },
                min: 1,
                max: 2,
            },
        },
    }),
    tryGetDefinition: () => undefined,
}));

import GraveyardFlashbackButton from "../graveyard-flashback-button";

function renderButton(opts: { wizard: boolean }) {
    const me = {
        id: "me",
        life: 20,
        hand: [],
        graveyard: [],
        exile: [],
        battlefield: opts.wizard
            ? [
                  {
                      id: "wiz",
                      card: { id: "wiz-def" },
                      controllerId: "me",
                      ownerId: "me",
                      zone: "battlefield",
                      isTapped: false,
                      types: ["Creature"],
                      subtypes: ["Human", "Wizard"],
                  },
              ]
            : [],
    };
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
        allPlayers: [me],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as unknown as React.ContextType<typeof GameContext>;
    const card: CardInstance = {
        id: "charm",
        card: { id: "charm-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        isTapped: false,
        legalActions: ["cast"],
        castKind: "flashback",
    };
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <GraveyardFlashbackButton card={card} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

describe("multi-select mode picker on the cast pipeline (issue #2264)", () => {
    beforeEach(() => {
        announceCast.mockClear();
        cleanup();
    });

    it("with a Wizard, offers two modes and dispatches both in printed order on Confirm", () => {
        renderButton({ wizard: true });
        fireEvent.click(screen.getByRole("button", { name: "Flashback" }));
        fireEvent.click(screen.getByRole("button", { name: /Mode three/ }));
        fireEvent.click(screen.getByRole("button", { name: /Mode one/ }));
        // Picking never commits — only Confirm does.
        expect(announceCast).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "charm",
            chosenModeIds: ["one", "three"],
        });
        expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    });

    it("without a Wizard, the count stays one — a second mode can't be picked", () => {
        renderButton({ wizard: false });
        fireEvent.click(screen.getByRole("button", { name: "Flashback" }));
        fireEvent.click(screen.getByRole("button", { name: /Mode one/ }));
        expect(
            screen.getByRole("button", { name: /Mode three/ })
        ).toBeDisabled();
    });
});
