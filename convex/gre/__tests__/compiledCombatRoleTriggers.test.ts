// Compiled combat-role heads reach the engine as REAL triggers (issue #4581):
// "becomes blocked" (CR 509.3c), "attacks or blocks" (CR 508.3a / 509.3a),
// "attacks alone" (CR 506.5), "deals combat damage to a creature" (CR 510.2)
// and "at the beginning of combat on each opponent's turn" (CR 603.2b).
//
// `oracle/__tests__/combatRoleTriggerHeads.test.ts` proves the Oracle text
// lowers to the right descriptor. It cannot prove the rebuilt ability FIRES on
// the right event, so each test compiles a real Oracle row, registers it, and
// drives it through the real emitters, trigger scan, stack and resolution.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition, GameEvent } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup.helper";
import { compileCard } from "../../oracle/compile";
import { oracleCard } from "../../oracle/__tests__/oracle.fixture";
import { projectPublicState } from "../../gameProjections";
import { getEffectivePower } from "../layers";
import {
    applyAllCombatDamage,
    emitAttackersDeclaredEvents,
    emitBlockersConfirmedEvents,
} from "../phases";
import { resolveTopOfStack, type GameState } from "../state";
import { collectTriggers } from "../triggers";

function register(
    name: string,
    manaCost: string,
    oracleText: string,
    power: string,
    toughness: string
): CardDefinition {
    const outcome = compileCard(
        oracleCard({
            name,
            manaCost,
            typeLine: "Creature — Beast",
            oracleText,
            power,
            toughness,
        })
    );
    if (outcome.state === "unparsed")
        throw new Error(`${name} unparsed: ${JSON.stringify(outcome.gaps)}`);
    const definition = {
        ...outcome.definition,
        id: `test-4581-${name}`,
        rarity: "common" as const,
    } as CardDefinition;
    registerTokenDefinition(definition);
    return definition;
}

const WOLVERINE = register(
    "Deepwood Wolverine",
    "{G}",
    "Whenever this creature becomes blocked, it gets +2/+0 until end of turn.",
    "1",
    "1"
);
const GHOUL = register(
    "Vedalken Ghoul",
    "{U}{B}",
    "Whenever this creature becomes blocked, defending player loses 4 life.",
    "1",
    "1"
);
const MERCHANT_SHIP = register(
    "Merchant Ship",
    "{1}{U}",
    "Whenever this creature attacks and isn't blocked, you gain 2 life.",
    "0",
    "2"
);
const GAINER = register(
    "Test Gainer",
    "{1}{G}",
    "Whenever this creature attacks or blocks, you gain 1 life.",
    "2",
    "2"
);
const ROGUE_KAVU = register(
    "Rogue Kavu",
    "{1}{R}",
    "Whenever this creature attacks alone, it gets +2/+0 until end of turn.",
    "1",
    "1"
);
const COBRA = register(
    "Voracious Cobra",
    "{2}{R}{G}",
    "Whenever this creature deals combat damage to a creature, destroy that creature.",
    "2",
    "2"
);
const SENTINEL = register(
    "Sentinel of the Eternal Watch",
    "{5}{W}",
    "At the beginning of combat on each opponent's turn, tap target creature that player controls.",
    "4",
    "6"
);

const BEAR = "test-4581-bear";
registerTokenDefinition({
    id: BEAR,
    name: "Test Bear",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 0,
    toughness: 5,
} satisfies CardDefinition);

const at = (def: string, id: string, controllerId: string) =>
    makeInstance(def, { id, controllerId, ownerId: controllerId });

/** p1 attacks with `attackers`; `blocks` is blockerId → attackerIds. */
function combat(
    p1: readonly [string, string][],
    p2: readonly [string, string][],
    attackerIds: string[],
    blocks: Record<string, string[]> = {},
    extra: Partial<NonNullable<GameState["combat"]>> = {}
): GameState {
    return makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                life: 20,
                battlefield: p1.map(([id, def]) => at(def, id, "p1")),
            }),
            makePlayer("p2", {
                life: 20,
                battlefield: p2.map(([id, def]) => at(def, id, "p2")),
            }),
        ],
        combat: {
            attackerIds,
            confirmed: true,
            blockerAssignments: blocks,
            blockersConfirmed: true,
            ...extra,
        },
        rngSeed: 1,
    });
}

function resolveAll(state: GameState): void {
    resolveTriggerOrder(state);
    let guard = 0;
    while (state.stack.length > 0 && guard++ < 10) resolveTopOfStack(state);
}

const permanent = (state: GameState, id: string) =>
    state.players.flatMap((p) => p.battlefield).find((c) => c.id === id);

describe("compiled 'whenever this creature becomes blocked' (CR 509.3c)", () => {
    it("fires ONCE for an attacker blocked by two creatures, and the pump survives the projection", () => {
        const state = combat(
            [["w", WOLVERINE.id]],
            [
                ["b1", BEAR],
                ["b2", BEAR],
            ],
            ["w"],
            { b1: ["w"], b2: ["w"] }
        );
        emitBlockersConfirmedEvents(state);
        expect(state.stack).toHaveLength(1);
        resolveAll(state);
        expect(getEffectivePower(state, permanent(state, "w")!)).toBe(3);
        const projected = projectPublicState(state, 1, "p2");
        const seen = projected.players[0]!.battlefield.find(
            (c) => c.id === "w"
        )!;
        expect(getEffectivePower(projected, seen)).toBe(3);
    });

    it("does not fire for an unblocked attacker beside a blocked one", () => {
        const state = combat(
            [
                ["w", WOLVERINE.id],
                ["x", BEAR],
            ],
            [["b1", BEAR]],
            ["w", "x"],
            { b1: ["x"] }
        );
        emitBlockersConfirmedEvents(state);
        expect(state.stack).toHaveLength(0);
    });

    it("does not fire for the creature that BLOCKS", () => {
        const state = combat([["x", BEAR]], [["w", WOLVERINE.id]], ["x"], {
            w: ["x"],
        });
        emitBlockersConfirmedEvents(state);
        expect(state.stack).toHaveLength(0);
    });

    it("'defending player' is the source controller's opponent (CR 508.5)", () => {
        const state = combat([["g", GHOUL.id]], [["b1", BEAR]], ["g"], {
            b1: ["g"],
        });
        emitBlockersConfirmedEvents(state);
        resolveAll(state);
        expect(state.players.map((p) => p.life)).toEqual([20, 16]);
    });

    it("a band member nobody blocks directly becomes blocked, and is not unblocked (CR 702.22h)", () => {
        const state = combat(
            [
                ["w", WOLVERINE.id],
                ["s", MERCHANT_SHIP.id],
                ["x", BEAR],
            ],
            [["b1", BEAR]],
            ["w", "s", "x"],
            { b1: ["x"] },
            { bands: [{ bandId: "band", memberIds: ["w", "s", "x"] }] }
        );
        emitBlockersConfirmedEvents(state);
        expect(state.stack.map((s) => s.triggeredAbilityId)).toEqual([
            "deepwood-wolverine-trigger",
        ]);
    });
});

describe("compiled 'whenever this creature attacks or blocks' (CR 508.3a / 509.3a)", () => {
    it("fires once on its own attack, not for another attacker", () => {
        const state = combat(
            [
                ["h", GAINER.id],
                ["h2", GAINER.id],
                ["x", BEAR],
            ],
            [],
            ["h", "x"]
        );
        emitAttackersDeclaredEvents(state);
        expect(state.stack).toHaveLength(1);
        const event = state.stack[0]!.triggerEvent;
        expect(
            event?.type === "ATTACKERS_DECLARED" && event.attackerIds
        ).toEqual(["h"]);
        resolveAll(state);
        expect(state.players[0]!.life).toBe(21);
    });

    it("fires once on its own block of two attackers, for its own controller", () => {
        const state = combat(
            [
                ["x", BEAR],
                ["y", BEAR],
            ],
            [
                ["h", GAINER.id],
                ["h2", GAINER.id],
            ],
            ["x", "y"],
            { h: ["x", "y"] }
        );
        emitBlockersConfirmedEvents(state);
        expect(state.stack).toHaveLength(1);
        resolveAll(state);
        expect(state.players.map((p) => p.life)).toEqual([20, 21]);
    });
});

describe("compiled 'whenever this creature attacks alone' (CR 506.5)", () => {
    it("fires when it is the only declared attacker", () => {
        const state = combat(
            [
                ["k", ROGUE_KAVU.id],
                ["x", BEAR],
            ],
            [],
            ["k"]
        );
        emitAttackersDeclaredEvents(state);
        expect(state.stack).toHaveLength(1);
        resolveAll(state);
        expect(getEffectivePower(state, permanent(state, "k")!)).toBe(3);
    });

    it("does not fire beside another attacker, nor when another creature attacks alone", () => {
        for (const attackers of [["k", "x"], ["x"]]) {
            const state = combat(
                [
                    ["k", ROGUE_KAVU.id],
                    ["x", BEAR],
                ],
                [],
                attackers
            );
            emitAttackersDeclaredEvents(state);
            expect(state.stack).toHaveLength(0);
        }
    });
});

describe("compiled 'whenever this creature deals combat damage to a creature' (CR 510.2)", () => {
    it("destroys the damaged blocker, and only it", () => {
        const state = combat(
            [["c", COBRA.id]],
            [
                ["b1", BEAR],
                ["b2", BEAR],
            ],
            ["c"],
            { b1: ["c"] }
        );
        state.phase = "COMBAT_DAMAGE";
        applyAllCombatDamage(state, { c: { b1: 2 } });
        resolveAll(state);
        expect(state.players[1]!.battlefield.map((c) => c.id)).toEqual(["b2"]);
        expect(permanent(state, "c")).toBeDefined();
    });

    it("does not fire on combat damage to a player", () => {
        const state = combat([["c", COBRA.id]], [], ["c"]);
        state.phase = "COMBAT_DAMAGE";
        applyAllCombatDamage(state, {});
        expect(state.stack).toHaveLength(0);
    });

    it("does not fire on NONCOMBAT damage to a creature", () => {
        const state = combat([["c", COBRA.id]], [["b1", BEAR]], ["c"]);
        const damage = (isCombat: boolean): GameEvent => ({
            type: "DAMAGE_DEALT",
            sourceInstanceId: "c",
            sourceControllerId: "p1",
            target: { type: "permanent", id: "b1" },
            amount: 2,
            isCombat,
        });
        expect(collectTriggers(state, [damage(true)])).toHaveLength(1);
        expect(collectTriggers(state, [damage(false)])).toHaveLength(0);
    });
});

describe("compiled 'at the beginning of combat on each opponent's turn' (CR 603.2b)", () => {
    const begin = (activePlayerId: string): GameEvent => ({
        type: "PHASE_BEGIN",
        phase: "BEGINNING_OF_COMBAT",
        activePlayerId,
    });

    it("fires on the opponent's combat and never on its controller's", () => {
        const state = combat([["e", BEAR]], [["s", SENTINEL.id]], []);
        expect(collectTriggers(state, [begin("p1")])).toHaveLength(1);
        expect(collectTriggers(state, [begin("p2")])).toHaveLength(0);
    });
});
