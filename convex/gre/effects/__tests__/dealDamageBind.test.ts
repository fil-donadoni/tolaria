// `dealDamage { bind }` — the field's permanent test (CR 608.2h / 704.5g).
//
// Driven through the real entry point: the spell is pushed and resolved by
// `resolveTopOfStack`. The trailing Op reads the binding's `.controller`, the
// "that player or that permanent's controller" shape (Chain Lightning). The
// wire-format assertion reads the result back through `projectPublicState`.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../../cards/registry";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import type { TargetSelection } from "../../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import { getDefinition } from "../../../cards/index";
import { resolveTopOfStack } from "../../state";
import { checkStateBasedActions } from "../../sba";
import type { GameState } from "../../state";
import { validateEffectScript } from "../validate";
import { projectPublicState } from "../../../gameProjections";

const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

/** Three damage to the announced target, then the target's controller (or
 *  the damaged player) gains 1 life — read off the snapshot. */
const SCRIPT: EffectOp[] = [
    { op: "dealDamage", amount: 3, to: { target: 0 }, bind: "$hit" },
    { op: "gainLife", amount: 1, player: { ref: "$hit.controller" } },
];

function spellDef(effects: EffectOp[]): CardDefinition {
    return {
        id: "test-deal-damage-bind",
        name: "Bind Probe",
        rarity: "common",
        oracleText: "",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        targetRequirement: { type: "any", count: 1 },
        effects,
    } as CardDefinition;
}

/** A 2/2 OWNED by p1 and CONTROLLED by p2, so `.controller` and `.owner`
 *  read different players. */
function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(grizzlyBears.id, {
                        id: "bear",
                        controllerId: "p2",
                        ownerId: "p1",
                    }),
                ],
            }),
        ],
    });
}

function resolveWith(
    effects: EffectOp[],
    target: TargetSelection,
    state = board()
): GameState {
    const def = spellDef(effects);
    withTemporaryDefinition(def, () => {
        pushSpell(state, def.id, "p1", [target]);
        resolveTopOfStack(state);
    });
    return state;
}

const life = (state: GameState, id: string) =>
    state.players.find((p) => p.id === id)!.life;
const onBattlefield = (state: GameState, id: string) =>
    state.players.some((p) => p.battlefield.some((c) => c.id === id));

describe("dealDamage { bind } — recipient snapshot (CR 608.2h)", () => {
    it("validates: the binding is a snapshot, so `.controller` refs resolve", () => {
        expect(validateEffectScript(spellDef(SCRIPT))).toEqual([]);
    });

    it("a permanent dealt LETHAL damage is still readable through the binding (CR 704.5g)", () => {
        const state = resolveWith(SCRIPT, { type: "permanent", id: "bear" });
        // Lethal damage is only marked; the SBA pass destroys the bear after
        // the resolution. The binding was read before, so this case does not
        // discriminate the snapshot's timing — the wither case below does.
        checkStateBasedActions(state);
        expect(onBattlefield(state, "bear")).toBe(false);
        expect(life(state, "p2")).toBe(21);
        expect(life(state, "p1")).toBe(20);
        // Wire format: the life delta survives the projection.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players.find((p) => p.id === "p2")!.life).toBe(21);
    });

    it("the snapshot is taken BEFORE the damage: wither's -1/-1 counters are not in it (CR 702.80a)", () => {
        // A wither source deals damage to a creature as -1/-1 counters, which
        // changes the recipient DURING the Op. A 2/2 dealt 1 damage reads
        // toughness 2 through a before-damage snapshot, 1 through an after.
        const def = {
            ...spellDef([
                {
                    op: "dealDamage",
                    amount: 1,
                    to: { target: 0 },
                    bind: "$hit",
                },
                {
                    op: "gainLife",
                    amount: { ref: "$hit.toughness" },
                    player: { ref: "$hit.controller" },
                },
            ]),
            staticAbilities: ["wither"],
        } as CardDefinition;
        const state = board();
        withTemporaryDefinition(def, () => {
            pushSpell(state, def.id, "p1", [{ type: "permanent", id: "bear" }]);
            resolveTopOfStack(state);
        });
        const bear = state.players[1]!.battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bear.counters?.["-1/-1"]).toBe(1);
        expect(life(state, "p2")).toBe(22);
    });

    it("`.owner` reads the owner, distinct from the controller (CR 108.3)", () => {
        const state = resolveWith(
            [
                SCRIPT[0]!,
                { op: "gainLife", amount: 1, player: { ref: "$hit.owner" } },
            ],
            { type: "permanent", id: "bear" }
        );
        expect(life(state, "p1")).toBe(21);
        expect(life(state, "p2")).toBe(20);
    });

    it("a PLAYER recipient snapshots as itself: `.controller` is that player", () => {
        const state = resolveWith(SCRIPT, { type: "player", id: "p2" });
        expect(life(state, "p2")).toBe(18);
        expect(life(state, "p1")).toBe(20);
    });

    it("no damage dealt → nothing bound → the trailing Op skips (CR 608.2b)", () => {
        const state = resolveWith(
            [{ ...SCRIPT[0]!, amount: 0 } as EffectOp, SCRIPT[1]!],
            { type: "permanent", id: "bear" }
        );
        expect(onBattlefield(state, "bear")).toBe(true);
        expect(life(state, "p2")).toBe(20);
    });
});
