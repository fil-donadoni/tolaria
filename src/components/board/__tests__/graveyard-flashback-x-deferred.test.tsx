// Regression: a Flashback cast with an {X} cost (Flash of Insight, JUD 40) is
// gated behind the CR 601.2b cost dialog. That dialog is rendered by the SAME
// component as the Flashback button (GraveyardFlashbackButton → useHandCardCommit
// overlays), and the button lives inside the Graveyard reveal dialog. The bug:
// the button used to call `onCommitted` (which closes the reveal) IMMEDIATELY on
// click — before the caster chose X — unmounting the whole component and its
// cost dialog. Symptom: the X dialog flashes for an instant, vanishes, and no
// cast is announced.
//
// The fix threads `onCommitted` into the hook and fires it at the REAL dispatch
// point, not on click. This test reproduces the host closing the reveal on
// `onCommitted` (unmounting the button) and asserts: the X dialog survives the
// click, and `announceCast` fires with the chosen X only after Confirm.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
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
// A Flash-of-Insight-shaped def: {X}{1}{U} Instant, no modes / alt-costs /
// Phyrexian pips, so the ONLY deferred step is the {X} cost dialog.
vi.mock("@convex/cards", () => ({
    getDefinition: () => ({
        name: "Flash of Insight",
        types: ["Instant"],
        manaCost: { X: "X", generic: 1, U: 1 },
    }),
    tryGetDefinition: () => undefined,
}));

import GraveyardFlashbackButton from "../graveyard-flashback-button";

function foiCard(): CardInstance {
    return {
        id: "foi",
        card: { id: "foi-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        isTapped: false,
        legalActions: ["cast"],
        castKind: "flashback",
        flashbackExileMaxX: 2,
    };
}

// Host mimicking the Graveyard reveal: it unmounts the Flashback button the
// instant `onCommitted` fires (the real reveal closes on commit). If the button
// closed the reveal on click, the X dialog would unmount with it.
function RevealHost({ card }: { card: CardInstance }) {
    const [open, setOpen] = useState(true);
    if (!open) return <div data-testid="reveal-closed" />;
    return (
        <GraveyardFlashbackButton
            card={card}
            onCommitted={() => setOpen(false)}
        />
    );
}

function renderButton(card: CardInstance) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <RevealHost card={card} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

describe("Flashback {X} cast from the graveyard reveal (Flash of Insight regression)", () => {
    beforeEach(() => {
        playCard.mockClear();
        announceCast.mockClear();
        cleanup();
    });

    it("keeps the X dialog mounted on click — does not close the reveal early", () => {
        renderButton(foiCard());
        fireEvent.click(screen.getByRole("button", { name: "Flashback" }));
        // The X dialog is up and the reveal has NOT closed (no announce yet).
        expect(screen.getByLabelText("Choose X")).toBeTruthy();
        expect(screen.queryByTestId("reveal-closed")).toBeNull();
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("dispatches announceCast with the chosen X only after Confirm, then closes the reveal", () => {
        renderButton(foiCard());
        fireEvent.click(screen.getByRole("button", { name: "Flashback" }));
        fireEvent.change(screen.getByLabelText("Choose X"), {
            target: { value: "1" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Cast" }));
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "foi",
            chosenX: 1,
        });
        // Reveal closes only now (onCommitted fired at dispatch).
        expect(screen.queryByTestId("reveal-closed")).toBeTruthy();
    });

    it("caps the X stepper at flashbackExileMaxX (payable blue cards, CR 702.34a)", () => {
        renderButton(foiCard());
        fireEvent.click(screen.getByRole("button", { name: "Flashback" }));
        const increase = screen.getByRole("button", { name: "Increase" });
        fireEvent.click(increase); // 1
        fireEvent.click(increase); // 2 (= maxX cap)
        expect((increase as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole("button", { name: "Cast" }));
        expect(announceCast.mock.calls[0][0]).toMatchObject({ chosenX: 2 });
    });
});
