// CR 112.2 — gaining control of a spell on the stack, and CR 115.7d — choosing
// new targets for it: the two Ops "Gain control of target spell. You may choose
// new targets for it." lowers to, driven through the real `resolveTopOfStack`
// and the raised-selection commit both the server and the Bot use.
import { describe, expect, it } from "vitest";
import type {
    CardDefinition,
    EffectOp,
    TargetSelection,
} from "../../cards/types";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getPlayer, resolveTopOfStack } from "../state";
import { applyRaisedTargetFinalization } from "../pendingTargetOrigin";
import { recomposeLayers2to5ForInstance, syncLayers2to5 } from "../layers2to5";
import { projectPublicState } from "../../gameProjections";
import { validateEffectScript } from "../effects/validate";
import { canPayHandCost } from "../alternativeCost";

const BEAR = "test-steal-bear";
registerTokenDefinition({
    id: BEAR,
    name: BEAR,
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    power: 2,
    toughness: 5,
});

function define(id: string, extra: Partial<CardDefinition>): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { U: 1 },
        types: ["Instant"],
        ...extra,
    });
    return id;
}

const STEAL: EffectOp[] = [
    {
        op: "gainControlOfSpell",
        target: { target: 0 },
        controller: "controller",
    },
    { op: "retarget", target: { target: 0 }, chooseNew: true },
];
const THIEF = define("test-steal-thief", {
    effects: STEAL,
    targetRequirement: { type: "spell", count: 1 },
});

const bear = (id: string, owner = "p2") =>
    makeInstance(BEAR, { id, controllerId: owner, ownerId: owner });
const permanent = (id: string): TargetSelection => ({ type: "permanent", id });

/** A spell of p2's with `thief` of p1's on top, aimed at it. */
function stolen(
    victimId: string,
    targets: TargetSelection[] = [],
    boards: { p1?: string[]; p2?: string[] } = {}
) {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: (boards.p1 ?? []).map((id) => bear(id, "p1")),
            }),
            makePlayer("p2", {
                battlefield: (boards.p2 ?? []).map((id) => bear(id, "p2")),
            }),
        ],
    });
    const victim = pushSpell(state, victimId, "p2", targets);
    pushSpell(state, THIEF, "p1", [{ type: "spell", id: victim.id }]);
    return { state, victim };
}

describe("gain control of a spell (CR 112.2)", () => {
    const DRAW = define("test-steal-draw", {
        effects: [{ op: "draw", count: 1, player: "controller" }],
    });
    const owned = (id: string) => makeInstance(BEAR, { id, ownerId: "p1" });

    it("resolves as the new controller's, and goes to its OWNER's graveyard", () => {
        const { state, victim } = stolen(DRAW);
        getPlayer(state, "p1").library = [owned("top1")];
        resolveTopOfStack(state);

        expect(victim.castById).toBe("p1");
        expect(victim.controllerId).toBe("p1");
        expect(victim.ownerId).toBe("p2");

        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").hand.map((c) => c.id)).toEqual(["top1"]);
        expect(getPlayer(state, "p2").hand).toEqual([]);
        expect(getPlayer(state, "p2").graveyard.map((c) => c.id)).toEqual([
            victim.id,
        ]);
        expect(getPlayer(state, "p1").graveyard.map((c) => c.id)).not.toContain(
            victim.id
        );
    });

    it("a permanent spell enters under the new controller and stays there through a layer sync (CR 110.2b)", () => {
        const ARTIFACT = define("test-steal-artifact", {
            types: ["Artifact"],
        });
        const { state, victim } = stolen(ARTIFACT);
        // An identity swap on the stack captures the layer 2 base: the caster.
        recomposeLayers2to5ForInstance(victim, "stack");
        expect(victim.baseControllerId).toBe("p2");

        resolveTopOfStack(state);
        resolveTopOfStack(state);
        syncLayers2to5(state);

        const entered = getPlayer(state, "p1").battlefield;
        expect(entered.map((c) => c.id)).toEqual([victim.id]);
        expect(entered[0]!.controllerId).toBe("p1");
        expect(entered[0]!.ownerId).toBe("p2");
        expect(getPlayer(state, "p2").battlefield).toEqual([]);
    });

    it("the old controller's controlled-cast prompts leave with the spell", () => {
        const { state, victim } = stolen(DRAW);
        victim.actingPlayerId = "p2";
        resolveTopOfStack(state);
        expect(victim.actingPlayerId).toBeUndefined();
    });

    it("a stolen rebound spell does not rebound: it was not cast from the new controller's hand (CR 702.88a)", () => {
        const { state, victim } = stolen(DRAW);
        getPlayer(state, "p1").library = [owned("top1")];
        victim.reboundFromHand = true;
        resolveTopOfStack(state);
        resolveTopOfStack(state);

        expect(getPlayer(state, "p2").graveyard.map((c) => c.id)).toEqual([
            victim.id,
        ]);
        expect(getPlayer(state, "p2").exile).toEqual([]);
        expect(state.delayedTriggers ?? []).toEqual([]);
    });

    it("leaves an ability alone, and skips a spell that already left the stack (CR 608.2b)", () => {
        // A requirement admitting abilities, or the legality gate blanks the
        // slot before the Op runs and the primitive's own guard is never read.
        const ANY_ABILITY = define("test-steal-ability-thief", {
            effects: STEAL,
            targetRequirement: {
                type: "spell",
                count: 1,
                spellStackKind: "ability",
            },
        });
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const ability = pushSpell(state, DRAW, "p2");
        ability.triggeredAbilityId = "some-trigger";
        pushSpell(state, ANY_ABILITY, "p1", [
            { type: "spell", id: ability.id },
        ]);
        resolveTopOfStack(state);
        expect(state.stack.map((s) => s.id)).toEqual([ability.id]);
        expect(ability.castById).toBe("p2");
        expect(ability.controllerId).toBe("p2");

        const gone = stolen(DRAW);
        gone.state.stack.splice(0, 1);
        expect(() => resolveTopOfStack(gone.state)).not.toThrow();
        expect(gone.victim.castById).toBe("p2");
    });

    it("the wire carries the new controller to both viewers", () => {
        const { state, victim } = stolen(DRAW);
        resolveTopOfStack(state);
        for (const viewer of ["p1", "p2"]) {
            const slim = projectPublicState(state, 1, viewer).stack.find(
                (s) => s.id === victim.id
            )!;
            expect(slim.castById).toBe("p1");
            expect(slim.controllerId).toBe("p1");
        }
    });

    it("the validator takes the Op, and only `true` as `chooseNew`", () => {
        const errorsOf = (effects: unknown[]) =>
            validateEffectScript({
                id: "probe",
                name: "probe",
                effects: effects as EffectOp[],
            });
        expect(errorsOf(STEAL)).toEqual([]);
        expect(
            errorsOf([{ op: "gainControlOfSpell", target: { target: 0 } }])
        ).not.toEqual([]);
        expect(
            errorsOf([
                { op: "retarget", target: { target: 0 }, chooseNew: false },
            ])
        ).not.toEqual([]);
    });
});

describe("choose new targets (CR 115.7d)", () => {
    const BOLT = define("test-steal-bolt", {
        effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        targetRequirement: { type: "Creature", count: 1 },
    });

    it("offers the new controller the spell's OWN requirement, and writes the pick onto the same spell", () => {
        const { state, victim } = stolen(BOLT, [permanent("b1")], {
            p2: ["b1", "b2"],
        });
        resolveTopOfStack(state);

        const pt = state.pendingTarget!;
        expect(pt).toMatchObject({
            kind: "retarget",
            playerId: "p1",
            cardInstanceId: victim.id,
            targetType: "Creature",
            count: 1,
        });
        pt.selected = [permanent("b2")];
        expect(applyRaisedTargetFinalization(state, pt)).toBe(true);
        expect(victim.targets).toEqual([permanent("b2")]);
        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack.map((s) => s.id)).toEqual([victim.id]);
    });

    it("raises nothing when the spell has no other legal target", () => {
        const { state, victim } = stolen(BOLT, [permanent("b1")], {
            p2: ["b1"],
        });
        resolveTopOfStack(state);
        expect(state.pendingTarget).toBeUndefined();
        expect(victim.targets).toEqual([permanent("b1")]);
    });

    it('reads "you" on the spell as the new controller', () => {
        const YOURS = define("test-steal-yours", {
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
        });
        const { state } = stolen(YOURS, [permanent("theirs")], {
            p1: ["mine"],
            p2: ["theirs"],
        });
        resolveTopOfStack(state);
        expect(state.pendingTarget).toMatchObject({
            kind: "retarget",
            playerId: "p1",
            controller: "you",
        });
    });

    it('holds an "up to two" spell to the number its cast fixed', () => {
        const UP_TO = define("test-steal-up-to", {
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
            targetRequirement: { type: "Creature", count: { min: 0, max: 2 } },
        });
        const { state } = stolen(UP_TO, [permanent("b1"), permanent("b2")], {
            p2: ["b1", "b2", "b3"],
        });
        resolveTopOfStack(state);
        expect(state.pendingTarget).toMatchObject({
            kind: "retarget",
            count: 2,
        });
    });

    it("changes nothing when the selection ends on another number of targets", () => {
        const { state, victim } = stolen(BOLT, [permanent("b1")], {
            p2: ["b1", "b2"],
        });
        resolveTopOfStack(state);
        const pt = state.pendingTarget!;
        pt.selected = [permanent("b1"), permanent("b2")];
        applyRaisedTargetFinalization(state, pt);
        expect(victim.targets).toEqual([permanent("b1")]);
    });

    it("keeps the original division, position by position (CR 115.7f)", () => {
        const DIVIDED = define("test-steal-divided", {
            effects: [{ op: "dealDamageDividedAsChosen", total: 3 }],
            targetRequirement: {
                type: "Creature",
                count: { min: 1, max: 3 },
                divideAsChosen: { total: 3 },
            },
        });
        const { state, victim } = stolen(
            DIVIDED,
            [permanent("b1"), permanent("b2")],
            { p2: ["b1", "b2", "b3"] }
        );
        victim.targetAmounts = { "permanent:b1": 2, "permanent:b2": 1 };
        resolveTopOfStack(state);

        const pt = state.pendingTarget!;
        pt.selected = [permanent("b3"), permanent("b1")];
        applyRaisedTargetFinalization(state, pt);
        expect(victim.targets).toEqual([permanent("b3"), permanent("b1")]);
        expect(victim.targetAmounts).toEqual({
            "permanent:b3": 2,
            "permanent:b1": 1,
        });
    });
});

describe('"exile two blue cards from your hand" (CR 118.9)', () => {
    const TWO_BLUE = {
        hand: {
            action: "exile" as const,
            requirements: [{ filter: { color: "U" as const }, count: 2 }],
        },
    };
    const BLUE = define("test-steal-blue-card", {});
    const inHand = (id: string) => makeInstance(BLUE, { id, ownerId: "p1" });

    it("needs two OTHER blue cards in hand", () => {
        const spell = inHand("spell");
        const one = makePlayer("p1", { hand: [spell, inHand("a")] });
        const two = makePlayer("p1", {
            hand: [spell, inHand("a"), inHand("b")],
        });
        expect(canPayHandCost(one, TWO_BLUE, spell.id)).toBe(false);
        expect(canPayHandCost(two, TWO_BLUE, spell.id)).toBe(true);
    });
});
