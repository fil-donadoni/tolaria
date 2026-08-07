// Manual state adapter (`~/lib/manual-board-adapter`). Pure mapping from the
// projected manual game state (`convex/manual.ts`) to the board's `Player`
// view type (`~/types/game`) — see PRD #2162 / ADR 0080.
import { describe, it, expect } from "vitest";
import type {
    ProjectedManualGameState,
    ProjectedManualPlayer,
} from "@convex/manual";
import { MANUAL_FACE_DOWN_CARD_ID } from "@convex/manual";
import { emptyManaPool } from "~/types/game";
import { adaptManualPlayer, adaptManualPlayers } from "../manual-board-adapter";

const BOLT_LEA = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const PLAINS_LEA = "b1623d57-4729-4796-b3f7-f1837a05c6ed";

function projectedPlayer(
    overrides: Partial<ProjectedManualPlayer> = {}
): ProjectedManualPlayer {
    return {
        id: "p1",
        name: "Alice",
        bgColor: "#123456",
        life: 20,
        hand: [
            {
                id: "h1",
                card: { id: BOLT_LEA },
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
                isTapped: false,
            },
        ],
        library: { count: 33 },
        graveyard: [],
        exile: [],
        battlefield: [
            {
                id: "bf1",
                card: { id: PLAINS_LEA },
                zone: "battlefield",
                controllerId: "p1",
                ownerId: "p1",
                isTapped: true,
                counters: { charge: 2 },
                attachedTo: undefined,
            },
        ],
        ...overrides,
    };
}

describe("adaptManualPlayer", () => {
    it("emits an empty mana pool and no other invented field", () => {
        const adapted = adaptManualPlayer(projectedPlayer());
        expect(adapted.manaPool).toEqual(emptyManaPool);
        // Every other field is a straight carry-over from the projection —
        // nothing besides `manaPool` was added.
        expect(Object.keys(adapted).sort()).toEqual(
            [
                "id",
                "name",
                "bgColor",
                "life",
                "hand",
                "library",
                "graveyard",
                "exile",
                "battlefield",
                "manaPool",
            ].sort()
        );
    });

    it("preserves the opponent's hand as hidden slots (null[])", () => {
        const opponent = projectedPlayer({
            hand: [null, null, null],
        });
        const adapted = adaptManualPlayer(opponent);
        expect(adapted.hand).toEqual([null, null, null]);
    });

    it("preserves the library as a count", () => {
        const adapted = adaptManualPlayer(
            projectedPlayer({ library: { count: 7 } })
        );
        expect(adapted.library).toEqual({ count: 7 });
    });

    it("preserves every card field the projection carries (counters, attachedTo, id, card, zone, controller/owner, isTapped)", () => {
        const adapted = adaptManualPlayer(projectedPlayer());
        expect(adapted.battlefield[0]).toEqual({
            id: "bf1",
            card: { id: PLAINS_LEA },
            zone: "battlefield",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
            counters: { charge: 2 },
            attachedTo: undefined,
        });
    });

    it("a face-down card the viewer may not see keeps its sentinel identity", () => {
        const adapted = adaptManualPlayer(
            projectedPlayer({
                battlefield: [
                    {
                        id: "fd1",
                        card: { id: MANUAL_FACE_DOWN_CARD_ID },
                        zone: "battlefield",
                        controllerId: "p2",
                        ownerId: "p2",
                        isTapped: false,
                        faceDown: true,
                    },
                ],
            })
        );
        expect(adapted.battlefield[0].card.id).toBe(MANUAL_FACE_DOWN_CARD_ID);
    });
});

describe("adaptManualPlayers", () => {
    it("adapts every seat in roster order", () => {
        const state: ProjectedManualGameState = {
            players: [
                projectedPlayer({ id: "p1" }),
                projectedPlayer({ id: "p2" }),
            ],
            turn: 1,
            activePlayerId: "p1",
        };
        const adapted = adaptManualPlayers(state);
        expect(adapted.map((p) => p.id)).toEqual(["p1", "p2"]);
        expect(adapted.every((p) => p.manaPool)).toBe(true);
    });
});
