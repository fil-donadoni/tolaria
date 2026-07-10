// Regression (Copy Artifact copy-target rejection): in a solo game the single
// user joins as seat p1, but a pending choice can be owed by p2 (e.g. Copy
// Artifact's "choose an artifact to copy" choice owed by the p2 caster). The
// board must submit that choice as the SOLO VIEWER seat — computeSoloViewerId,
// which follows the choice owner — not the fixed join seat, or the Expected
// Input gate rejects it: "the game is waiting for choice input from another
// player" (ADR 0047).
//
// This pins the exact seam board.tsx wires: the REAL computeSoloViewerId feeds
// the REAL usePendingChoiceBufferState (as `playerId`), and its submit must
// carry the choice owner's id. A hand-picked seat would mask the bug, so both
// units are the production ones.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { computeSoloViewerId } from "~/lib/priority";
import { usePendingChoiceBufferState } from "~/hooks/usePendingChoiceBuffer";
import type { PendingChoice } from "~/types/game";
import type { Id } from "@convex/_generated/dataModel";

const submitSpy = vi.fn(() => Promise.resolve(null));
vi.mock("convex/react", () => ({
    useMutation: () => submitSpy,
}));

const JOIN_SEAT = "u-p1";
const CASTER_SEAT = "u-p2";

// A Copy Artifact copy-target choice owed by p2 (the caster), while the
// artifact to copy sits on p1's battlefield (allControllers).
const copyTargetChoice: PendingChoice = {
    kind: "choose-permanents",
    playerId: CASTER_SEAT,
    stackItemId: "121",
    choiceId: "copy-artifact-target",
    step: 0,
    prompt: "Choose an artifact for Copy Artifact to copy.",
    count: 1,
    zone: "battlefield",
    filter: { types: "Artifact" },
    allControllers: true,
} as unknown as PendingChoice;

describe("solo pending-choice submit uses the viewer seat (ADR 0047)", () => {
    beforeEach(() => submitSpy.mockClear());

    it("submits a choice owed by the OTHER solo seat as that seat, not the join seat", async () => {
        // Board's own selection: viewer follows the choice owner in solo.
        const viewerId = computeSoloViewerId({
            activePlayerId: CASTER_SEAT,
            priorityPlayerId: CASTER_SEAT,
            phase: "PRECOMBAT_MAIN",
            pendingChoices: [copyTargetChoice],
            playerIds: [JOIN_SEAT, CASTER_SEAT],
        });
        expect(viewerId).toBe(CASTER_SEAT); // NOT the join seat

        // Board feeds that viewerId into the buffer (the line under test).
        const { result } = renderHook(() =>
            usePendingChoiceBufferState({
                gameId: "g1" as Id<"games">,
                playerId: viewerId,
                activeChoice: copyTargetChoice,
            })
        );

        // Pick p1's artifact (id "130") and submit.
        act(() => result.current.toggle("130"));
        await act(async () => {
            await result.current.submit();
        });

        expect(submitSpy).toHaveBeenCalledTimes(1);
        expect(submitSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                playerId: CASTER_SEAT,
                stackItemId: "121",
                choiceId: "copy-artifact-target",
                cardInstanceIds: ["130"],
            })
        );
    });
});
