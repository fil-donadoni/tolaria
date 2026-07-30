import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { projectPublicState } from "@convex/gameProjections";
import {
    answerChoice,
    drawStepEvent,
    makeSylvanState,
    resolveTrigger,
} from "@convex/cards/sets/leg/__tests__/helpers";

// Same harness shape as put-back-picker.test.tsx: capture the picker props so
// the mount contract can be asserted without the real drag surface.
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

type PickerProps = {
    lookedAt: { instanceId: string; defId: string }[];
    putBack?: { keep: number; min?: number };
    onConfirm: (top: string[], second: string[]) => Promise<void> | void;
};

/** Runs Sylvan Library's draw-step trigger through the REAL engine, accepts the
 *  optional draw, then projects the suspended state through the client view
 *  reducer (`projectPublicState`) — the picker below is driven by the projected
 *  view, never a hand-built one (`.claude/rules/gre-development.md` §
 *  Frontend wiring analysis). */
function projectedSylvanPick(life = 20) {
    const { state, sylvan } = makeSylvanState({
        handIds: ["h0", "x9"], // h0 drawn this turn, x9 already in hand
        libIds: ["l0", "l1", "l2"],
        drawnThisTurn: ["h0"],
        life,
    });
    resolveTrigger(state, sylvan, "sylvan-library-draw-step", drawStepEvent);
    answerChoice(state, ["yes"]); // "you may draw two additional cards"
    return projectPublicState(state, 1, "p1");
}

function renderWithProjection(
    projected: ReturnType<typeof projectPublicState>
) {
    const value = {
        gameId: "game-id" as never,
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "DRAW",
        turn: 1,
        engineTurn: 1,
        stackCount: projected.stack.length,
        allPlayers: projected.players as unknown as Player[],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
        pendingChoices: projected.pendingChoices,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PutBackPicker />
        </GameContext>
    );
}

describe("Sylvan Library put-on-top pick — client wiring (issue #1691)", () => {
    it("mounts a real modal picker whose pool is exactly the cards drawn this turn", () => {
        pickerSpy.mockClear();
        const projected = projectedSylvanPick();
        // The engine's pick survives the wire projection intact.
        const head = projected.pendingChoices?.[0];
        expect(head?.choiceId).toBe("ranged-topdeck");
        expect(head?.putOnTop).toBe(true);
        expect(head?.candidateIds).toEqual(["h0", "l0", "l1"]);

        const { queryByTestId } = renderWithProjection(projected);
        expect(queryByTestId("picker")).not.toBeNull();

        const props = pickerSpy.mock.calls.at(-1)?.[0] as PickerProps;
        // x9 was in hand BEFORE this turn — it must not be selectable.
        expect(props.lookedAt.map((c) => c.instanceId)).toEqual([
            "h0",
            "l0",
            "l1",
        ]);
        // Ranged 0–2 pick (CR 118.4): the player may keep both (pay 8), put
        // both back (pay 0), or mix (pay 4).
        expect(props.putBack).toEqual({ keep: 2, min: 0 });
    });

    it("keeps the CR 119.4 floor when the controller cannot pay for both kept cards", () => {
        pickerSpy.mockClear();
        // 4 life → floor(4 / 4) = 1 keepable, so at least 1 of the 2 must go
        // back on top.
        const projected = projectedSylvanPick(4);
        renderWithProjection(projected);
        const props = pickerSpy.mock.calls.at(-1)?.[0] as PickerProps;
        expect(props.putBack).toEqual({ keep: 2, min: 1 });
    });

    it("submits the picked cards so the last id lands on top", async () => {
        pickerSpy.mockClear();
        submitSpy.mockClear();
        const projected = projectedSylvanPick();
        renderWithProjection(projected);
        const props = pickerSpy.mock.calls.at(-1)?.[0] as PickerProps;
        // Picker yields TOPMOST-FIRST.
        await props.onConfirm(["l1", "l0"], []);
        expect(submitSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                choiceId: "ranged-topdeck",
                cardInstanceIds: ["l0", "l1"],
            })
        );
    });
});
