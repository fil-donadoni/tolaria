// CR 101.4 — `forEach { set: "players", simultaneous: true }` over a per-player
// "unless they pay" body: every player's payment decision in APNAP order,
// then all the damage together (Lim-Dûl's Hex).
import { describe, it, expect } from "vitest";
import type { EffectOp, GameState } from "../../../cards/types";
import { getDefinition } from "../../../cards/index";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { resolveTopOfStack } from "../../state";
import { applyMayPaySubmit } from "../../index";
import { checkGameOverSBA } from "../../sba";
import { validateEffectScript, type EffectScriptHost } from "../validate";

const HEX_ID = "af976f42-3d56-4e32-8294-970a276a4bf3";

const host = (effects: EffectOp[]): EffectScriptHost => ({
    id: "test-host",
    name: "Test Host",
    effects,
});

const mayPayB: EffectOp = {
    op: "mayPay",
    player: { ref: "$each" },
    cost: { B: 1 },
    prompt: "Pay {B}?",
    bind: "$paid",
};
const damageEach: EffectOp = {
    op: "dealDamage",
    amount: 1,
    to: { player: { ref: "$each" } },
};
const unlessPaid = (then: EffectOp[]): EffectOp => ({
    op: "if",
    predicate: { not: { binding: "$paid" } },
    then,
});
const overPlayers = (effects: EffectOp[]): EffectOp => ({
    op: "forEach",
    select: { set: "players" },
    simultaneous: true,
    effects,
});
const rejected = (errors: string[]): boolean =>
    errors.some((e) =>
        /"simultaneous" over \{ set: "players" \} requires "effects".*"mayPay"/.test(
            e
        )
    );

describe("validateEffectScript — simultaneous players may-pay body (CR 101.4)", () => {
    it("accepts [mayPay, if !paid → dealDamage]", () => {
        expect(
            validateEffectScript(
                host([overPlayers([mayPayB, unlessPaid([damageEach])])])
            )
        ).toEqual([]);
    });

    it("accepts Lim-Dûl's Hex's nested {B}-or-{3} tree", () => {
        const def = getDefinition(HEX_ID);
        const script = def.triggeredAbilities![0].effects!;
        expect(validateEffectScript(host(script))).toEqual([]);
    });

    it("rejects an action ahead of the decision", () => {
        const errors = validateEffectScript(
            host([overPlayers([damageEach, mayPayB])])
        );
        expect(rejected(errors)).toBe(true);
    });

    it("rejects an `if` reading the board (it would be evaluated twice)", () => {
        const errors = validateEffectScript(
            host([
                overPlayers([
                    mayPayB,
                    {
                        op: "if",
                        predicate: {
                            left: { kickerCount: true },
                            op: "ge",
                            right: 1,
                        },
                        then: [damageEach],
                    },
                ]),
            ])
        );
        expect(rejected(errors)).toBe(true);
    });

    it("rejects damage aimed at a player other than the iterated one", () => {
        const errors = validateEffectScript(
            host([
                overPlayers([
                    mayPayB,
                    unlessPaid([
                        {
                            op: "dealDamage",
                            amount: 1,
                            to: { player: "controller" },
                        },
                    ]),
                ]),
            ])
        );
        expect(rejected(errors)).toBe(true);
    });

    it("rejects a may-pay offered to someone other than the iterated player", () => {
        const errors = validateEffectScript(
            host([
                overPlayers([
                    { ...mayPayB, player: "controller" } as EffectOp,
                    unlessPaid([damageEach]),
                ]),
            ])
        );
        expect(rejected(errors)).toBe(true);
    });
});

describe("Lim-Dûl's Hex — choices first, then damage together (CR 101.4 / 104.4a)", () => {
    function setup(life: number): GameState {
        const hex = makeInstance(HEX_ID, {
            id: "hex",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hex], life }),
                makePlayer("p2", { life }),
            ],
        });
        state.activePlayerId = "p1";
        state.stack.push({
            ...hex,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "lim-duls-hex-upkeep",
            triggerSourceId: hex.id,
            triggerEvent: {
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId: "p1",
            },
            targets: [],
        } as never);
        resolveTopOfStack(state);
        return state;
    }
    const decline = (state: GameState, playerId: string) => {
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe(playerId);
        applyMayPaySubmit(state, { playerId, accept: false });
    };

    it("p2 decides before p1's damage lands (CR 101.4b), then both are dealt 1", () => {
        const state = setup(20);
        decline(state, "p1"); // {B}
        decline(state, "p1"); // {3}
        // p2's turn to choose: p1 has declined both legs, but under CR 101.4
        // the damage waits for every player's choice.
        expect(state.pendingChoices![0].playerId).toBe("p2");
        expect(state.players[0].life).toBe(20);
        decline(state, "p2"); // {B}
        decline(state, "p2"); // {3}
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players.map((p) => p.life)).toEqual([19, 19]);
    });

    it("both players at 1 life, both decline — simultaneous damage, the game is a draw (CR 104.4a)", () => {
        const state = setup(1);
        decline(state, "p1");
        decline(state, "p1");
        expect(state.players[0].life).toBe(1); // nothing applied yet
        decline(state, "p2");
        decline(state, "p2");
        expect(state.players.map((p) => p.life)).toEqual([0, 0]);
        checkGameOverSBA(state);
        expect(state.gameOver).toMatchObject({ isDraw: true });
    });
});
