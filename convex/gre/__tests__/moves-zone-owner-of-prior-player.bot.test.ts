/**
 * CR 601.2c + CR 404.1 (issue #2912) — the Bot's group enumerator keeps a
 * "cards from target player's graveyard" group inside the graveyard of the
 * player an earlier group announced (Drafna's Restoration). Groups are
 * enumerated independently, so without the filter the search would value
 * casts naming p2 and then a card from p1's graveyard, which the server's
 * `zoneOwnerId` check refuses.
 */
import { describe, expect, it } from "vitest";
import { getDefinition } from "../../cards";
import { enumerateMoves, type Move } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

type CastMove = Extract<Move, { kind: "cast-spell" }>;

function board() {
    const spell = makeInstance("4be2aa3b-207b-4d21-abfb-6788520c7676", {
        id: "drafna",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const gy = (id: string, owner: string, cardId: string) =>
        makeInstance(cardId, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone: "graveyard",
        });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [spell],
                graveyard: [
                    gy("mine", "p1", "64975352-8d35-4d02-94ac-fa0c6ee12409"),
                ],
                manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2", {
                graveyard: [
                    gy("theirs", "p2", "07793a71-1106-4303-b620-e403bd378020"),
                ],
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

describe("bot enumeration — zoneOwnerOfPriorPlayerTarget (issue #2912)", () => {
    it("never pairs a player with a card from another player's graveyard", () => {
        expect(
            getDefinition("4be2aa3b-207b-4d21-abfb-6788520c7676")
        ).toBeDefined();
        const casts = enumerateMoves(board(), "p1").filter(
            (m): m is CastMove =>
                m.kind === "cast-spell" && m.cardInstanceId === "drafna"
        );
        expect(casts.length).toBeGreaterThan(0);
        const withCards = casts.filter((m) =>
            m.targets.some((t) => t.type === "graveyard-card")
        );
        expect(withCards.length).toBeGreaterThan(0);
        for (const m of withCards) {
            const player = m.targets.find((t) => t.type === "player")!;
            for (const t of m.targets.filter(
                (t) => t.type === "graveyard-card"
            )) {
                expect(t.playerId).toBe(player.id);
            }
        }
    });
});
