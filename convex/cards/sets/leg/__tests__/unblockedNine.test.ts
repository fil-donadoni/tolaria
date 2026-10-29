// Legends (LEG) — the nine cards of issue #2124. Combat-pair field forwards
// (`colors`, `role`, CR 509.1h / 202.2), Land Tax's intervening-if, the basic
// supertype gate (CR 205.4a), Relic Bind's announced modes (CR 603.3c) and
// Vampire Bats' activation cap (CR 602.5).

import { describe, it, expect } from "vitest";
import { resolveTrigger } from "./set.helper";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup.helper";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    advancePhase,
    emitBlockersConfirmedEvents,
} from "../../../../gre/phases";
import { getDefinition } from "../../../index";

const abomination = getDefinition("a69e2cf8-5ecb-485a-92a2-b4e0a7959f1f");
const infernalMedusa = getDefinition("26a5333f-2761-42b8-ae8b-1d360b109daf");
const vampireBats = getDefinition("6a6a6f50-7b86-461e-80a7-e35d0e7cf52f");
const relicBind = getDefinition("a9b07dc4-21ad-410b-8f8a-2b034253bfee");
const landTax = getDefinition("d53b20b0-67bc-4587-817b-efbf21cb2512");
const untamedWilds = getDefinition("887f22af-8b92-422a-9cd5-f3977674bcdc");

const GRIZZLY = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // green
const SAVANNAH_LIONS = "d05b92bd-797e-413f-a8b0-32e0937a1ee0"; // white
const BLACK_KNIGHT = "c1662949-0d69-49a3-8c69-daf10717ed4e"; // black
const WALL_OF_STONE = "140e567c-6e4a-42b0-8084-d6c9695ae802"; // red Wall
const PLAINS = "b1623d57-4729-4796-b3f7-f1837a05c6ed";
const TUNDRA = "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb";

/** `source` (p1 if it attacks, else p2) vs. `otherId`; a block is confirmed. */
function combat(sourceId: string, otherId: string, sourceAttacks: boolean) {
    const src = makeInstance(sourceId, {
        id: "src",
        controllerId: sourceAttacks ? "p1" : "p2",
        ownerId: sourceAttacks ? "p1" : "p2",
        zone: "battlefield",
        isAttacking: sourceAttacks ? true : undefined,
        isBlocking: sourceAttacks ? undefined : true,
    });
    const other = makeInstance(otherId, {
        id: "other",
        controllerId: sourceAttacks ? "p2" : "p1",
        ownerId: sourceAttacks ? "p2" : "p1",
        zone: "battlefield",
        isAttacking: sourceAttacks ? undefined : true,
        isBlocking: sourceAttacks ? true : undefined,
    });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: sourceAttacks ? [src] : [other],
            }),
            makePlayer("p2", {
                battlefield: sourceAttacks ? [other] : [src],
            }),
        ],
        phase: "DECLARE_BLOCKERS",
        combat: {
            attackerIds: [sourceAttacks ? "src" : "other"],
            confirmed: true,
            blockerAssignments: sourceAttacks
                ? { other: ["src"] }
                : { src: ["other"] },
            blockersConfirmed: true,
        },
    });
}

function triggered(state: ReturnType<typeof combat>): string[] {
    emitBlockersConfirmedEvents(state);
    return state.stack.map((s) => s.triggeredAbilityId!);
}

describe("Abomination (colour gate read off the event, CR 509.1h / 202.2)", () => {
    it.each([
        ["green", GRIZZLY],
        ["white", SAVANNAH_LIONS],
    ])("triggers against a %s creature, on either side", (_c, other) => {
        expect(triggered(combat(abomination.id, other, true))).toEqual([
            "abomination-combat-kill",
        ]);
        expect(triggered(combat(abomination.id, other, false))).toEqual([
            "abomination-combat-kill",
        ]);
    });

    it("does NOT trigger against a black creature", () => {
        expect(triggered(combat(abomination.id, BLACK_KNIGHT, true))).toEqual(
            []
        );
    });

    it("destroys the green creature at end of combat", () => {
        const state = combat(abomination.id, GRIZZLY, true);
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        state.phase = "COMBAT_DAMAGE";
        advancePhase(state);
        resolveTopOfStack(state);
        expect(state.players[1].graveyard.some((c) => c.id === "other")).toBe(
            true
        );
    });
});

describe("Infernal Medusa (two lines, each on its own direction, CR 509.1h / 603.2)", () => {
    it("has two triggered abilities, one per Oracle line", () => {
        expect(infernalMedusa.triggeredAbilities!.map((t) => t.id)).toEqual([
            "infernal-medusa-blocks",
            "infernal-medusa-blocked",
        ]);
    });

    it("blocking: fires for ANY attacker, including a Wall", () => {
        expect(
            triggered(combat(infernalMedusa.id, WALL_OF_STONE, false))
        ).toEqual(["infernal-medusa-blocks"]);
        expect(triggered(combat(infernalMedusa.id, GRIZZLY, false))).toEqual([
            "infernal-medusa-blocks",
        ]);
    });

    it("blocked: fires for a non-Wall blocker", () => {
        expect(triggered(combat(infernalMedusa.id, GRIZZLY, true))).toEqual([
            "infernal-medusa-blocked",
        ]);
    });

    it("blocked: a Wall blocking Medusa does NOT trigger the non-Wall line", () => {
        expect(
            triggered(combat(infernalMedusa.id, WALL_OF_STONE, true))
        ).toEqual([]);
    });
});

describe("Vampire Bats (activate no more than twice each turn, CR 602.5)", () => {
    it("refuses the third activation", () => {
        const ability = vampireBats.activatedAbilities![0];
        const at = (n: number) =>
            makeInstance(vampireBats.id, {
                id: `bats-${n}`,
                controllerId: "p1",
                activationsThisTurn: { "vampire-bats-pump": n },
            });
        expect(ability.canActivate!(at(1) as never, {} as never)).toBe(true);
        expect(ability.canActivate!(at(2) as never, {} as never)).toBe(false);
    });
});

describe("Land Tax (intervening-if + basic-only up-to-three search, CR 603.4 / 205.4a)", () => {
    const ability = landTax.triggeredAbilities![0];
    const upkeep = {
        type: "PHASE_BEGIN",
        phase: "UPKEEP",
        activePlayerId: "p1",
    } as never;
    const lands = (owner: string, n: number) =>
        Array.from({ length: n }, (_, i) =>
            makeInstance(PLAINS, {
                id: `${owner}-land-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "battlefield",
            })
        );

    it("is gated on an opponent controlling MORE lands", () => {
        const tax = makeInstance(landTax.id, {
            id: "tax",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const check = (mine: number, theirs: number) =>
            ability.interveningIf!(
                upkeep,
                tax as never,
                makeState({
                    players: [
                        makePlayer("p1", { battlefield: lands("p1", mine) }),
                        makePlayer("p2", { battlefield: lands("p2", theirs) }),
                    ],
                }) as never
            );
        expect(check(1, 2)).toBe(true);
        expect(check(2, 2)).toBe(false);
        expect(check(3, 2)).toBe(false);
    });

    it("offers only basic lands (never a dual), optional, up to three", () => {
        const tax = makeInstance(landTax.id, {
            id: "tax",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const lib = [
            makeInstance(TUNDRA, {
                id: "dual",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
            ...[1, 2, 3, 4].map((i) =>
                makeInstance(PLAINS, {
                    id: `basic${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "library",
                })
            ),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tax], library: lib }),
                makePlayer("p2", { battlefield: lands("p2", 2) }),
            ],
        });
        resolveTrigger(state, tax, "land-tax-upkeep", upkeep);
        const head = state.pendingChoices![0];
        expect(head.candidateIds).not.toContain("dual");
        expect(head.candidateIds).toHaveLength(4);
        expect(head.count).toEqual({ min: 0, max: 3 });
    });
});

describe("Untamed Wilds (basic land only, CR 205.4a)", () => {
    it("does not offer a dual land from the library", () => {
        const wilds = makeInstance(untamedWilds.id, {
            id: "wilds",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        makeInstance(TUNDRA, {
                            id: "dual",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                        makeInstance(PLAINS, {
                            id: "basic",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...wilds,
            zone: "stack",
            castById: "p1",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].candidateIds).toEqual(["basic"]);
    });
});

describe("Relic Bind (modal trigger, CR 603.3c)", () => {
    it("announces a mode with its own target when the host becomes tapped", () => {
        const ability = relicBind.triggeredAbilities![0];
        expect(ability.modes!.map((m) => m.id)).toEqual([
            "damage",
            "gain-life",
        ]);
        expect(ability.modes!.every((m) => m.targetRequirement)).toBe(true);
        expect(relicBind.targetRequirement).toEqual({
            type: "Artifact",
            count: 1,
            controller: "opponent",
        });
    });
});
