// Issue #1233 — a `choose-aura-host` choice (CR 303.4: an "Enchant player"
// Aura entering with no fixed target) must make its candidate PLAYERS'
// nameplates pickable, through the same client buffer as the player picks.
//
// The choice is produced by the real engine (`putReanimatedSetOnBattlefield`),
// pushed through the REAL wire projection (`projectPublicState`) and handed to
// the REAL hook through a real `GameContext` — no hand-built view.

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { registerTokenDefinition } from "@convex/cards";
import type { CardDefinition } from "@convex/cards/types";
import { projectPublicState } from "@convex/gameProjections";
import { putReanimatedSetOnBattlefield } from "@convex/gre/state";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { usePlayerInteraction } from "../usePlayerInteraction";

vi.mock("convex/react", () => ({
    useMutation: () => async () => {},
}));
vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
        dismissError: vi.fn(),
    }),
}));
vi.mock("~/hooks/useDivideBuffer", () => ({
    useDivideBuffer: () => ({
        active: false,
        remaining: 0,
        get: () => 0,
        inc: vi.fn(),
        dec: vi.fn(),
    }),
}));

const AURA_ID = "test-only-enchant-player-aura-ui";
const auraDef: CardDefinition = {
    id: AURA_ID,
    rarity: "common",
    name: "Test Enchant-Player Aura (ui)",
    oracleText: "Enchant player",
    manaCost: { B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "player", count: 1 },
};
registerTokenDefinition(auraDef);

type Ctx = React.ContextType<typeof GameContext>;

/** Ids of the nameplates the hook marks pickable for `viewerId`, with the
 *  engine's choice optionally narrowed before it crosses the projection. */
function pickableSeats(
    viewerId: string,
    narrowTo?: string[]
): { kind: string | undefined; seats: string[] } {
    const aura = makeInstance(AURA_ID, {
        id: "aura-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "graveyard",
    });
    const state = makeState({
        players: [makePlayer("p1", { graveyard: [aura] }), makePlayer("p2")],
    });
    putReanimatedSetOnBattlefield(state, [{ card: aura, controllerId: "p1" }]);
    if (narrowTo) state.pendingChoices![0].candidatePlayerIds = narrowTo;

    const projected = projectPublicState(state, 1, viewerId);
    const allPlayers = projected.players as unknown as Player[];
    const ctx = {
        gameId: "game-id" as never,
        playerId: viewerId,
        activePlayerId: projected.activePlayerId,
        priorityPlayerId: projected.priorityPlayerId,
        phase: projected.phase,
        turn: 1,
        engineTurn: projected.turn,
        stackCount: 0,
        stackItems: [],
        allPlayers,
        pendingChoices: projected.pendingChoices,
        showAllCards: false,
        debugAllActions: false,
    } as unknown as NonNullable<Ctx>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    return {
        kind: projected.pendingChoices?.[0]?.kind,
        seats: allPlayers
            .filter(
                (p) =>
                    renderHook(() => usePlayerInteraction(p), { wrapper })
                        .result.current.isDamageTargetPickable
            )
            .map((p) => p.id),
    };
}

describe("usePlayerInteraction — choose-aura-host player candidates (CR 303.4, issue #1233)", () => {
    it("rings every candidate player's nameplate for the chooser", () => {
        expect(pickableSeats("p1")).toEqual({
            kind: "choose-aura-host",
            seats: ["p1", "p2"],
        });
    });

    it("does not ring a player outside candidatePlayerIds", () => {
        expect(pickableSeats("p1", ["p2"]).seats).toEqual(["p2"]);
    });

    it("rings nothing for a viewer who is not the chooser", () => {
        expect(pickableSeats("p2").seats).toEqual([]);
    });
});
