// Compiled "is dealt damage" / "deals damage to a player" / "attacks and isn't
// blocked" heads reach the engine as REAL triggers (issue #4544, CR 120.3 /
// 509.1h / 603.2).
//
// `oracle/__tests__/combatDamageTriggerHeads.test.ts` proves the Oracle text
// lowers to the right descriptor. It cannot prove the rebuilt ability FIRES on
// the right event — only for THIS creature, only on damage to a player, only
// for an attacker nobody blocked — nor that "that much" reads the damage the
// creature was dealt. So each test compiles a real Oracle row, registers it,
// and drives it through the engine: real combat damage, the real trigger scan,
// the real stack, the real resolution.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup.helper";
import { compileCard } from "../../oracle/compile";
import { oracleCard } from "../../oracle/__tests__/oracle.fixture";
import { applyAllCombatDamage, emitBlockersConfirmedEvents } from "../phases";
import { resolveTopOfStack, type GameState } from "../state";

function register(
    id: string,
    card: ReturnType<typeof oracleCard>
): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    const definition = {
        ...outcome.definition,
        id,
        rarity: "common" as const,
    } as CardDefinition;
    registerTokenDefinition(definition);
    return definition;
}

const JACKAL_PUP = register(
    "test-4544-jackal-pup",
    oracleCard({
        name: "Jackal Pup",
        manaCost: "{R}",
        typeLine: "Creature — Jackal",
        oracleText:
            "Whenever this creature is dealt damage, it deals that much damage to you.",
        power: "2",
        toughness: "1",
    })
);

const HIGH_PRIEST = register(
    "test-4544-high-priest",
    oracleCard({
        name: "High Priest of Penance",
        manaCost: "{W}{B}",
        typeLine: "Creature — Human Cleric",
        oracleText:
            "Whenever this creature is dealt damage, you may destroy target nonland permanent.",
        power: "1",
        toughness: "1",
    })
);

const ABYSSAL_SPECTER = register(
    "test-4544-abyssal-specter",
    oracleCard({
        name: "Abyssal Specter",
        manaCost: "{2}{B}{B}",
        typeLine: "Creature — Specter",
        oracleText:
            "Whenever this creature deals damage to a player, that player discards a card.",
        power: "2",
        toughness: "3",
    })
);

const MERCHANT_SHIP = register(
    "test-4544-merchant-ship",
    oracleCard({
        name: "Merchant Ship",
        manaCost: "{1}{U}",
        typeLine: "Creature — Human",
        oracleText:
            "Whenever this creature attacks and isn't blocked, you gain 2 life.",
        power: "0",
        toughness: "2",
    })
);

const BEAR = "test-4544-bear";
registerTokenDefinition({
    id: BEAR,
    name: "Test Bear",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 3,
    toughness: 5,
} satisfies CardDefinition);

const handOf = (n: number, owner: string) =>
    Array.from({ length: n }, (_, i) =>
        makeInstance(BEAR, {
            id: `${owner}-hand-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: "hand",
        })
    );

/** p1's `attacker`, optionally blocked by p2's Bear; `bystander` is a second
 *  p1 creature that takes no part in combat. */
function combat(opts: {
    attackerDef: string;
    blocked?: boolean;
    bystander?: string;
    p2Hand?: number;
    phase?: "COMBAT_DAMAGE" | "DECLARE_BLOCKERS";
}): GameState {
    const attacker = makeInstance(opts.attackerDef, {
        id: "attacker",
        controllerId: "p1",
        ownerId: "p1",
        isAttacking: true,
    });
    const blocker = makeInstance(BEAR, {
        id: "blocker",
        controllerId: "p2",
        ownerId: "p2",
        isBlocking: opts.blocked === true,
    });
    const bystander =
        opts.bystander === undefined
            ? []
            : [
                  makeInstance(opts.bystander, {
                      id: "bystander",
                      controllerId: "p1",
                      ownerId: "p1",
                  }),
              ];
    return makeState({
        phase: opts.phase ?? "COMBAT_DAMAGE",
        activePlayerId: "p1",
        players: [
            makePlayer("p1", {
                life: 20,
                battlefield: [attacker, ...bystander],
            }),
            makePlayer("p2", {
                life: 20,
                battlefield: opts.blocked ? [blocker] : [],
                hand: handOf(opts.p2Hand ?? 0, "p2"),
            }),
        ],
        combat: {
            attackerIds: ["attacker"],
            confirmed: true,
            blockerAssignments: opts.blocked ? { blocker: ["attacker"] } : {},
            blockersConfirmed: true,
        },
        rngSeed: 1,
    });
}

function resolveAll(state: GameState): void {
    resolveTriggerOrder(state);
    let guard = 0;
    while (state.stack.length > 0 && guard++ < 10) resolveTopOfStack(state);
}

const triggerIds = (state: GameState) =>
    state.stack.map((s) => s.triggeredAbilityId);

describe("'whenever this creature is dealt damage, it deals that much damage to you' (CR 120.3)", () => {
    it("reads the damage the creature was DEALT — a 3/5 blocker deals 3, so the controller takes 3", () => {
        const state = combat({ attackerDef: JACKAL_PUP.id, blocked: true });
        applyAllCombatDamage(state, { attacker: { blocker: 2 } });
        expect(triggerIds(state)).toEqual(["jackal-pup-trigger"]);
        resolveAll(state);
        expect(state.players[0]!.life).toBe(17);
    });

    it("does not fire when the creature takes no damage (unblocked)", () => {
        const state = combat({ attackerDef: JACKAL_PUP.id });
        applyAllCombatDamage(state, {});
        expect(triggerIds(state)).not.toContain("jackal-pup-trigger");
    });

    it("does not fire for damage dealt to ANOTHER creature the controller owns", () => {
        // The Pup stays home; a second p1 creature is blocked and hurt.
        const state = combat({
            attackerDef: BEAR,
            blocked: true,
            bystander: JACKAL_PUP.id,
        });
        applyAllCombatDamage(state, { attacker: { blocker: 3 } });
        expect(triggerIds(state)).not.toContain("jackal-pup-trigger");
    });
});

describe("a damage head that announces a target (CR 603.3d)", () => {
    it("announces the target as the trigger goes on the stack — the rebuilt ability keeps targetRequirement", () => {
        const state = combat({ attackerDef: HIGH_PRIEST.id, blocked: true });
        applyAllCombatDamage(state, { attacker: { blocker: 1 } });
        expect(triggerIds(state)).toEqual(["high-priest-of-penance-trigger"]);
        expect(state.stack[0]?.targets).toEqual([
            { type: "permanent", id: "blocker" },
        ]);
    });
});

describe("'whenever this creature deals damage to a player, that player discards a card'", () => {
    it("the DAMAGED player is asked to discard", () => {
        const state = combat({ attackerDef: ABYSSAL_SPECTER.id, p2Hand: 2 });
        applyAllCombatDamage(state, {});
        expect(triggerIds(state)).toEqual(["abyssal-specter-trigger"]);
        resolveAll(state);
        expect(state.pendingChoices?.[0]?.playerId).toBe("p2");
    });

    it("does not fire for damage dealt to a creature", () => {
        const state = combat({
            attackerDef: ABYSSAL_SPECTER.id,
            blocked: true,
            p2Hand: 2,
        });
        applyAllCombatDamage(state, { attacker: { blocker: 2 } });
        expect(triggerIds(state)).not.toContain("abyssal-specter-trigger");
    });
});

describe("'whenever this creature attacks and isn't blocked' (CR 509.1h)", () => {
    it("fires once the block graph is final and nobody blocked the attacker", () => {
        const state = combat({
            attackerDef: MERCHANT_SHIP.id,
            phase: "DECLARE_BLOCKERS",
        });
        emitBlockersConfirmedEvents(state);
        expect(triggerIds(state)).toEqual(["merchant-ship-trigger"]);
        resolveAll(state);
        expect(state.players[0]!.life).toBe(22);
    });

    it("does not fire when the attacker was blocked", () => {
        const state = combat({
            attackerDef: MERCHANT_SHIP.id,
            blocked: true,
            phase: "DECLARE_BLOCKERS",
        });
        emitBlockersConfirmedEvents(state);
        expect(triggerIds(state)).not.toContain("merchant-ship-trigger");
    });

    it("fires for ITS OWN attacker only — another creature going unblocked does not trigger it", () => {
        const ship = makeInstance(MERCHANT_SHIP.id, {
            id: "ship",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const runner = makeInstance(BEAR, {
            id: "runner",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(BEAR, {
            id: "blocker",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { life: 20, battlefield: [ship, runner] }),
                makePlayer("p2", { life: 20, battlefield: [blocker] }),
            ],
            combat: {
                attackerIds: ["ship", "runner"],
                confirmed: true,
                blockerAssignments: { blocker: ["ship"] },
                blockersConfirmed: true,
            },
            rngSeed: 1,
        });
        emitBlockersConfirmedEvents(state);
        expect(triggerIds(state)).not.toContain("merchant-ship-trigger");
    });
});
