// Escalate (CR 702.120a, issue #2267) — the client half. The mode picker opens
// BEFORE `announceCast`, and the server refuses a mode count whose escalate
// cost the caster cannot pay (CR 601.2h), so the picker caps its max with the
// server's own `perExtraModeAffordableModeCap`, read off the WIRE view. And an
// escalate entry is never a cast-cost dialog toggle: its count follows the
// modes, written by the server.

import { describe, expect, it } from "vitest";
import type { GameState } from "@convex/gre/state";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { collectiveBrutality } from "@convex/cards/sets/emn/black.cards";
import { grizzlyBears, plains } from "@convex/cards/sets/lea/index.cards";
import type { CardInstance, Player } from "~/types/game";
import {
    affordableKickersForCard,
    escalateModeCapForCard,
} from "../card-utils";
import { modePickerConstraint } from "../mode-picker-constraint";

function board(spare: number): GameState {
    const mine = (id: string, cardId: string) =>
        makeInstance(cardId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    mine("cb", collectiveBrutality().id),
                    ...Array.from({ length: spare }, (_, i) =>
                        mine(`spare${i}`, plains().id)
                    ),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(grizzlyBears().id, {
                        id: "bears",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "battlefield",
                    }),
                ],
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function wire(spare: number): { players: Player[]; card: CardInstance } {
    const view = projectPublicState(board(spare), 1, "p1");
    const players = view.players as unknown as Player[];
    const card = players[0].hand.find((c) => c?.id === "cb")!;
    return { players, card };
}

describe("Escalate — the mode picker is capped by what the hand can pay (CR 702.120a / 601.2h)", () => {
    it.each([
        [0, 1],
        [1, 2],
        [2, 3],
        [5, 3],
    ])("%i spare card(s) in hand → at most %i mode(s)", (spare, cap) => {
        const { players, card } = wire(spare);
        expect(escalateModeCapForCard(card, "p1", players, "p1", 3)).toBe(cap);
        const def = collectiveBrutality();
        const constraint = modePickerConstraint({
            modes: def.modes!,
            selection: def.modeSelection,
            facts: { controls: () => false, kicked: false },
            isModeLegal: () => true,
            affordableModeCap: escalateModeCapForCard(
                card,
                "p1",
                players,
                "p1",
                3
            ),
        });
        expect(constraint.max).toBe(cap);
        expect(constraint.requiredCount).toBe(1);
    });

    it("the escalate entry is never offered as a cast-cost dialog toggle", () => {
        const { players, card } = wire(2);
        expect(affordableKickersForCard(card, "p1", players, "p1")).toEqual([]);
    });
});
