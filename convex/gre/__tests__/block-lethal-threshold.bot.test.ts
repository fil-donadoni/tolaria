// The block-quality valuation must use the SAME notion of lethal damage the
// engine assigns with (CR 702.19b / CR 702.2c, issue #2444).
//
// `declaredBlockDelta` simulates the declared block to price it. It used to
// compare raw effective toughness on both sides, so it valued two combats the
// engine resolves very differently as identical:
//
//   * a deathtouch attacker (CR 702.2c — any nonzero amount it assigns is
//     lethal damage) read as unable to kill a bigger blocker;
//   * a blocker already carrying marked damage (CR 702.19b — marked damage
//     counts toward lethal) read as surviving a hit that in fact kills it.
//
// Both now go through `lethalDamageThreshold`, shared with
// `gre/damageAssignment.ts`. Asserts the ORDERING contract this file's
// neighbours use, not the magnitudes.
import { describe, expect, it } from "vitest";
import type { CardInstanceState, GameState } from "../state";
import type { CardType } from "../../cards/types";
import { declaredBlockDelta } from "../evaluate";
import { makePlayer, makeState } from "../../cards/__tests__/setup";

function creature(
    id: string,
    power: number,
    toughness: number,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id,
        card: { id: `def-${id}` },
        types: ["Creature"] as CardType[],
        subtypes: [],
        power,
        toughness,
        staticAbilities: [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

/** p1 attacks with `attacker`; p2 blocks with `blocker`. */
function blockState(
    attacker: CardInstanceState,
    blocker: CardInstanceState
): GameState {
    return makeState({
        phase: "DECLARE_BLOCKERS",
        players: [
            makePlayer("p1", { battlefield: [attacker] }),
            makePlayer("p2", { battlefield: [blocker] }),
        ],
        combat: {
            attackerIds: [attacker.id],
            confirmed: true,
            blockerAssignments: { [blocker.id]: [attacker.id] },
            blockersConfirmed: true,
        },
    });
}

describe("declaredBlockDelta lethal threshold (CR 702.2c, issue #2444)", () => {
    it("prices a deathtouch attacker as killing the blocker it cannot out-size", () => {
        const blocker = () =>
            creature("blk", 4, 4, {
                controllerId: "p2",
                ownerId: "p2",
                isBlocking: true,
            });
        const plain = blockState(
            creature("atk", 1, 1, { isAttacking: true }),
            blocker()
        );
        const deadly = blockState(
            creature("atk", 1, 1, {
                staticAbilities: ["deathtouch"],
                isAttacking: true,
            }),
            blocker()
        );

        // Same board, same trade for the attacker (its 1 toughness dies either
        // way) — but blocking a deathtouch creature costs the defender its 4/4,
        // so the block must be valued strictly WORSE for the defender.
        expect(declaredBlockDelta(deadly, "p2")).toBeLessThan(
            declaredBlockDelta(plain, "p2")
        );
    });

    it("counts damage already marked on the blocker (CR 702.19b)", () => {
        const attacker = () =>
            creature("atk", 2, 5, { isAttacking: true, staticAbilities: [] });
        const healthy = blockState(
            attacker(),
            creature("blk", 1, 3, {
                controllerId: "p2",
                ownerId: "p2",
                isBlocking: true,
            })
        );
        const damaged = blockState(
            attacker(),
            creature("blk", 1, 3, {
                controllerId: "p2",
                ownerId: "p2",
                isBlocking: true,
                damageMarked: 2,
            })
        );

        // The 2-power attacker cannot kill a fresh 3-toughness blocker, but it
        // does kill one already carrying 2 damage.
        expect(declaredBlockDelta(damaged, "p2")).toBeLessThan(
            declaredBlockDelta(healthy, "p2")
        );
    });
});
