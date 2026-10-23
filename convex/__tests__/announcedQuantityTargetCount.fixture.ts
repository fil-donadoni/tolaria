/**
 * CR 601.2c / 107.3 (issue #6526) — a hand-written definition of Reap's
 * target shape, shared by the full-path test and the Bot enumerator test. Its
 * Grammar Rule is issue #5703's; every shape in it is one the engine authors.
 */
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { blackKnight, grizzlyBears } from "../cards/sets/lea/index.cards";
import type { CardDefinition } from "../cards/types";
import type { GameState } from "../gre/state";

export const REAP_SPELL_ID = "reap-1";

/** Reap's shape: the opponent is announced FIRST (slot 0) so the graveyard
 *  group's bound can read it; slots 1–3 are the returned cards. */
export const REAP_SHAPE: CardDefinition = {
    id: "test-reap-shape",
    name: "Test Reap Shape",
    rarity: "common",
    types: ["Instant"],
    manaCost: { G: 1 },
    oracleText:
        "Return up to X target cards from your graveyard to your hand, where X is the number of black permanents target opponent controls as you cast this spell.",
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
    additionalTargetRequirements: [
        {
            type: "card",
            zone: "graveyard",
            controller: "you",
            count: {
                min: 0,
                max: {
                    count: {
                        zone: "battlefield",
                        controller: { target: 0 },
                        filter: { color: "B" },
                    },
                },
            },
        },
    ],
    effects: [1, 2, 3].map((slot) => ({
        op: "moveZone" as const,
        target: { target: slot },
        to: "hand" as const,
    })),
};

function knight(id: string): ReturnType<typeof makeInstance> {
    return makeInstance(blackKnight().id, {
        id,
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });
}

/** p1 holds the spell, G floating, three cards in the graveyard; p2 controls
 *  `blackCount` Black Knights and one (green) Grizzly Bears. */
export function reapBoard(blackCount: number): GameState {
    const spell = makeInstance(REAP_SHAPE.id, {
        id: REAP_SPELL_ID,
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const graveyard = ["gy-a", "gy-b", "gy-c"].map((id) =>
        makeInstance(grizzlyBears().id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        })
    );
    const bear = makeInstance(grizzlyBears().id, {
        id: "bear",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [spell],
                graveyard,
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
            }),
            makePlayer("p2", {
                battlefield: [
                    ...Array.from({ length: blackCount }, (_, i) =>
                        knight(`knight-${i}`)
                    ),
                    bear,
                ],
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}
