// CR 700.2 — the modal mode picker must be GONE the moment the cast is
// dispatched.
//
// Lorehold Charm's second mode announces a graveyard target, so the graveyard
// dialog opens immediately on top of the picker. A picker left standing behind
// it re-offers a decision that has already been made, which reads as if the
// click hadn't registered. `commitAnnounceCast` clears every pre-cast picker at
// the single dispatch point, so this holds whichever picker opened the cast.
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
// A Lorehold-Charm-shaped def: a plain modal instant, no {X} / alt-cost /
// Phyrexian step, so the mode picker is the ONLY deferred stage.
const MODES = [
    { id: "sacrifice-artifact", label: "Mode one", oracleText: "Mode one." },
    { id: "reanimate", label: "Mode two", oracleText: "Mode two." },
];
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) => mockInstanceManaCost(c),
    getDefinition: () => ({
        name: "Lorehold Charm",
        types: ["Instant"],
        manaCost: { W: 1, R: 1 },
        modes: MODES,
    }),
    tryGetDefinition: () => undefined,
}));

import GraveyardFlashbackButton from "../graveyard-flashback-button";

function charmCard(): CardInstance {
    return {
        id: "charm",
        card: { id: "charm-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        isTapped: false,
        legalActions: ["cast"],
        castKind: "flashback",
    };
}

function renderButton() {
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
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <GraveyardFlashbackButton card={charmCard()} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

describe("modal mode picker closes on cast (Lorehold Charm)", () => {
    beforeEach(() => {
        playCard.mockClear();
        announceCast.mockClear();
        cleanup();
    });

    it("dismisses the picker as the cast is dispatched", () => {
        renderButton();
        fireEvent.click(screen.getByRole("button", { name: "Flashback" }));
        // The picker is up with both modes offered.
        expect(screen.getByRole("button", { name: /Mode two/ })).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: /Mode two/ }));

        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "charm",
            chosenModeId: "reanimate",
        });
        // …and no mode button is left on screen.
        expect(screen.queryByRole("button", { name: /Mode one/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /Mode two/ })).toBeNull();
    });
});
