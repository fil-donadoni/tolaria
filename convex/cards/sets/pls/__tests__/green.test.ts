// PLS (Planeshift) — green card behavior tests (ADR 0043 colour split).
// Each card's describe block cites the CR section it exercises.
import { describe, it, expect } from "vitest";
import { mirrorwoodTreefolk } from "../green";
import { crawWurm } from "../../lea/green";
import { lightningBolt } from "../../lea/red";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { resolveTopOfStack } from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";

const REDIRECT_ABILITY_ID = "mirrorwood-treefolk-redirect";

/** Activates Mirrorwood Treefolk's redirect ability and answers the
 *  mid-resolution `choose-damage-target` pick with `pickedId` (a
 *  `candidateIds` permanent id or a `candidatePlayerIds` player id) —
 *  mirrors Jade Monolith's `pick-source` test pattern
 *  (`convex/cards/sets/lea/__tests__/colorless.test.ts`). */
function activateAndPickTarget(
    state: GameState,
    treefolkId: string,
    pickedId: string
) {
    const act = pushSpell(state, mirrorwoodTreefolk.id, "p1", []);
    act.abilityId = REDIRECT_ABILITY_ID;
    act.id = treefolkId; // the ability's own stack item IS the source (ctx.sourceInstanceId)
    resolveTopOfStack(state);
    expect(state.pendingChoices).toHaveLength(1);
    const head = state.pendingChoices![0];
    expect(head.kind).toBe("choose-damage-target");
    const choiceItem = state.stack.find((s) => s.id === head.stackItemId)!;
    choiceItem.collectedChoices = {
        ...(choiceItem.collectedChoices ?? {}),
        [`${head.step}:${head.choiceId}`]: [pickedId],
    };
    state.pendingChoices = undefined;
    resolveTopOfStack(state);
}

describe("Mirrorwood Treefolk ({3}{G} 2/4 — one-shot damage redirect, CR 614/115.4)", () => {
    it("is a {3}{G} 2/4 Treefolk with the modern oracle text", () => {
        expect(mirrorwoodTreefolk.manaCost).toEqual({ X: 3, G: 1 });
        expect(mirrorwoodTreefolk.types).toEqual(["Creature"]);
        expect(mirrorwoodTreefolk.subtypes).toEqual(["Treefolk"]);
        expect(mirrorwoodTreefolk.power).toBe(2);
        expect(mirrorwoodTreefolk.toughness).toBe(4);
        expect(mirrorwoodTreefolk.oracleText).toBe(
            "{2}{R}{W}: The next time damage would be dealt to this creature this turn, that damage is dealt to any target instead."
        );
        expect(mirrorwoodTreefolk.activatedAbilities?.[0]?.cost).toEqual({
            mana: { X: 2, R: 1, W: 1 },
        });
    });

    it("redirects the next damage to this creature to a chosen PERMANENT (CR 115.4)", () => {
        const mwt = makeInstance(mirrorwoodTreefolk.id, {
            id: "mwt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mwt] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        activateAndPickTarget(state, "mwt", "bear");

        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "mwt" },
        ]);
        expect(resolveTopOfStack(state)).not.toBeNull();

        const mwtAfter = state.players[0].battlefield.find(
            (c) => c.id === "mwt"
        )!;
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(mwtAfter.damageMarked).toBeUndefined();
        expect(bearAfter.damageMarked).toBe(3);
    });

    it("redirects the next damage to this creature to a chosen PLAYER (CR 115.4)", () => {
        const mwt = makeInstance(mirrorwoodTreefolk.id, {
            id: "mwt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mwt] }),
                makePlayer("p2", { battlefield: [], life: 20 }),
            ],
        });
        activateAndPickTarget(state, "mwt", "p2");

        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "mwt" },
        ]);
        expect(resolveTopOfStack(state)).not.toBeNull();

        const mwtAfter = state.players[0].battlefield.find(
            (c) => c.id === "mwt"
        )!;
        expect(mwtAfter.damageMarked).toBeUndefined();
        expect(state.players[1].life).toBe(17);
    });

    it("is one-shot — a second instance of damage this turn is NOT redirected (CR 614)", () => {
        const mwt = makeInstance(mirrorwoodTreefolk.id, {
            id: "mwt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mwt] }),
                makePlayer("p2", { battlefield: [], life: 20 }),
            ],
        });
        activateAndPickTarget(state, "mwt", "p2");

        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "mwt" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17); // redirected, shield spent

        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "mwt" },
        ]);
        resolveTopOfStack(state);
        const mwtAfter = state.players[0].battlefield.find(
            (c) => c.id === "mwt"
        )!;
        expect(mwtAfter.damageMarked).toBe(3); // second bolt lands on mwt itself
        expect(state.players[1].life).toBe(17); // unchanged — shield already spent
    });

    it("holds through the real damage pipeline and survives the wire projection (CR 614)", () => {
        const mwt = makeInstance(mirrorwoodTreefolk.id, {
            id: "mwt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mwt] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        activateAndPickTarget(state, "mwt", "bear");

        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "mwt" },
        ]);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 0, "p1");
        const slimMwt = projected.players[0].battlefield.find(
            (c) => c.id === "mwt"
        );
        const slimBear = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(slimMwt?.damageMarked).toBeUndefined();
        expect(slimBear?.damageMarked).toBe(3);
    });
});
