// Frontend wiring for the CR 614.12a as-enters MODE pick (issue #2019).
//
// The trap this file exists for: `useHandCardCommit` opens the CR 700.2c modal
// `ModePicker` for any card whose definition carries `modes`. Ten shipped
// permanents (Voice of All, Prismatic Ward, Quirion Elves, Jihad, …) reuse the
// SAME `modes`/`chosenModeId` idiom for a CR 614.1c as-enters choice, and this
// slice moved that choice off cast announcement and onto the CR 614 entry
// chokepoint. So for those ten the announcement-time picker must NOT open —
// `announceCast` now REJECTS a `chosenModeId` for them, so a picker left in
// place is not a cosmetic double-prompt but a hard server rejection on the
// only button the caster has.
//
// What replaces it is a genuinely DIFFERENT client prompt: an as-enters
// `option-pick` raised by the engine as the permanent enters, carrying
// `stackItemId: ""` and a `subjectCardId` — a shape the board renders from the
// pending-choice surface, not from this hook. This test pins only the hook's
// half of that boundary: the cast click must dispatch straight through for an
// as-enters card, and must still open the picker for an ordinary modal spell.
//
// Assertions run through the REAL reducer and the REAL card definitions —
// `@convex/cards` is not mocked, the hand card comes out of
// `projectPublicState`, and the picker is the real `ModePicker`. A hand-built
// view or a stubbed definition would mask exactly the drop this guards.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { resetPendingGameIntents } from "~/lib/pending-intent-store";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: vi.fn(),
    clear: vi.fn(),
    submit: vi.fn(() => Promise.resolve()),
    isPending: false,
    lastError: null,
    reportError: vi.fn(),
    dismissError: vi.fn(),
};

const playCard = vi.fn();
const announceCast = vi.fn();
const activateAbility = vi.fn().mockResolvedValue(undefined);
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "playCard"
            ? playCard
            : ref._name === "activateAbility"
              ? activateAbility
              : announceCast,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            playCard: { _name: "playCard" },
            announceCast: { _name: "announceCast" },
            activateAbility: { _name: "activateAbility" },
        },
    },
}));
// Inert visuals only — definition, projection and picker are all the real thing.
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../card-tilt-3d", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import BoardHandCard from "../board-hand-card";
import { projectPublicState } from "@convex/gameProjections";
import { declaresAsEntersMode } from "@convex/gre/constants";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { voiceOfAll } from "@convex/cards/sets/pls/white";
import { visionCharm } from "@convex/cards/sets/vis/blue";

/** The given card in `me`'s hand with mana to spare, in `me`'s own main phase
 *  with an empty stack, run through the REAL wire projection. */
function projectedHandCard(cardId: string, instanceId: string): CardInstance {
    const state = makeState({
        players: [
            makePlayer("me", {
                hand: [
                    makeInstance(cardId, {
                        id: instanceId,
                        controllerId: "me",
                        ownerId: "me",
                        zone: "hand",
                    }),
                ],
                manaPool: { W: 7, U: 7, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer("them"),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "me",
        priorityPlayerId: "me",
    });
    const projected = projectPublicState(state, 1, "me");
    return projected.players[0].hand[0] as unknown as CardInstance;
}

function renderCard(card: CardInstance) {
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
                <BoardHandCard card={card} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

const el = () =>
    screen.getByTestId("card-image").closest("[data-board-hand-card]")!;

/** The real `ModePicker` renders in a portal tagged `data-slot="dialog-content"`
 *  (the board's global ESC handler keys off the same tag). Query the document,
 *  not the card subtree — the portal escapes it. */
const pickerOpen = () =>
    document.querySelectorAll('[data-slot="dialog-content"]').length > 0;

beforeEach(() => {
    playCard.mockClear();
    announceCast.mockClear();
    cleanup();
    resetPendingGameIntents();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
});

describe("cast-click mode gate for an as-enters choice (CR 614.12a, #2019)", () => {
    it("Voice of All: no announcement-time ModePicker, and announceCast carries no chosenModeId", () => {
        // The premise the gate reads — asserted from the real definition so the
        // test goes red if the card stops declaring the clause, not only if the
        // gate is removed.
        expect(declaresAsEntersMode(voiceOfAll)).toBe(true);
        expect(voiceOfAll.modes && voiceOfAll.modes.length).toBeGreaterThan(0);

        const card = projectedHandCard(voiceOfAll.id, "voice1");
        expect(card.legalActions).toContain("cast");

        renderCard(card);
        fireEvent.click(el());

        // The colour is chosen as the permanent ENTERS, by the engine, on every
        // entry path — never here. A picker opening here would send a
        // `chosenModeId` that `announceCast` hard-rejects.
        expect(pickerOpen()).toBe(false);
        expect(screen.queryByRole("button", { name: "Red" })).toBeNull();
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "voice1",
        });
        expect(announceCast.mock.calls[0][0].chosenModeId).toBeUndefined();
    });

    it("Vision Charm (the must-NOT row): an ordinary modal spell still opens the picker before announcing", () => {
        expect(declaresAsEntersMode(visionCharm)).toBe(false);

        const card = projectedHandCard(visionCharm.id, "charm1");
        expect(card.legalActions).toContain("cast");

        renderCard(card);
        fireEvent.click(el());

        // CR 700.2c — the mode is chosen at announcement for a real modal
        // spell, so nothing is dispatched until the caster picks one.
        expect(pickerOpen()).toBe(true);
        expect(announceCast).not.toHaveBeenCalled();

        fireEvent.click(
            screen.getByRole("button", {
                name: /Target player mills four cards/,
            })
        );
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "charm1",
            chosenModeId: "mill",
        });
    });
});
