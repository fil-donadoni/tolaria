// Bot visibility and costing for Harmonize (CR 702.180), the half of
// `harmonize.test.ts` that touches bot-only modules. Enumeration reaches it
// through the generic graveyard-cast loop (`graveyardCastMechanism`); the Move
// names the creature buying the largest reduction, its tap plan is priced with
// that reduction and kept off that creature, and both search sandboxes tap it
// and stamp the exile.
import { describe, it, expect } from "vitest";
import { enumerateMoves } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { getPlayer, type GameState } from "../state";
import { withTemporaryDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import {
    crawWurm,
    grizzlyBears,
    lightningBolt,
    mountain,
} from "../../cards/sets/lea/index.cards";

/** Lightning Bolt with "Harmonize {3}{R}". */
const HZ_INSTANT: CardDefinition = {
    ...lightningBolt(),
    id: "test-hz-instant",
    harmonize: { X: 3, R: 1 },
};

function board(opts: { mountains: number; creatures: string[] }): GameState {
    const owned = { controllerId: "p1", ownerId: "p1" };
    return makeState({
        players: [
            makePlayer("p1", {
                graveyard: [
                    makeInstance(HZ_INSTANT.id, {
                        ...owned,
                        id: "gyHz",
                        zone: "graveyard",
                    }),
                ],
                battlefield: [
                    ...Array.from({ length: opts.mountains }, (_, i) =>
                        makeInstance(mountain().id, {
                            ...owned,
                            id: `land${i}`,
                            zone: "battlefield",
                        })
                    ),
                    ...opts.creatures.map((defId, i) =>
                        makeInstance(defId, {
                            ...owned,
                            id: `creature${i}`,
                            zone: "battlefield",
                        })
                    ),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function castAtOpponent(state: GameState) {
    const move = enumerateMoves(state, "p1").find(
        (m) =>
            m.kind === "cast-spell" &&
            m.cardInstanceId === "gyHz" &&
            m.targets.some((t) => t.type === "player" && t.id === "p2")
    );
    return move?.kind === "cast-spell" ? move : undefined;
}

describe("Harmonize: Bot visibility (CR 702.180)", () => {
    it("names the creature buying the largest reduction and prices the tap plan with it", () => {
        withTemporaryDefinition(HZ_INSTANT, () => {
            // {3}{R} less the Wurm's 6 power = {R}: one Mountain.
            const move = castAtOpponent(
                board({
                    mountains: 1,
                    creatures: [grizzlyBears().id, crawWurm().id],
                })
            );
            expect(move?.harmonizeCreatureId).toBe("creature1");
            expect(move?.castFromZone).toBe("graveyard");
            expect(move?.tapPlan).toHaveLength(1);
        });
    });

    it("enumerates nothing when even the largest reduction leaves the cost unpaid", () => {
        withTemporaryDefinition(HZ_INSTANT, () => {
            // {3}{R} less the Bears' 2 = {1}{R}: one Mountain is short.
            expect(
                castAtOpponent(
                    board({ mountains: 1, creatures: [grizzlyBears().id] })
                )
            ).toBeUndefined();
        });
    });

    it("the greedy sandbox taps the named creature and exiles the spell after it resolves", () => {
        withTemporaryDefinition(HZ_INSTANT, () => {
            const state = board({ mountains: 1, creatures: [crawWurm().id] });
            const after = applyMoveForSearch(
                state,
                "p1",
                castAtOpponent(state)!
            );
            const p1 = getPlayer(after, "p1");
            expect(
                p1.battlefield.find((c) => c.id === "creature0")?.isTapped
            ).toBe(true);
            expect(p1.exile.map((c) => c.id)).toEqual(["gyHz"]);
            expect(getPlayer(after, "p2").life).toBe(17);
        });
    });

    it("the ISMCTS sandbox taps the same creature and stamps the exile", () => {
        withTemporaryDefinition(HZ_INSTANT, () => {
            const state = board({ mountains: 1, creatures: [crawWurm().id] });
            applyMoveInSearch(state, "p1", castAtOpponent(state)!);
            const p1 = getPlayer(state, "p1");
            expect(
                p1.battlefield.find((c) => c.id === "creature0")?.isTapped
            ).toBe(true);
            const item = state.stack.find((s) => s.id === "gyHz")!;
            expect(item.castFromZone).toBe("graveyard");
            expect(item.exileAnyTimeLeavesStack).toBe(true);
        });
    });
});
