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
import type { TargetSelection } from "../../../types";

const REDIRECT_ABILITY_ID = "mirrorwood-treefolk-redirect";

/** Activates Mirrorwood Treefolk's redirect ability with `target` announced
 *  at activation (CR 602.2b) — the ability's `targetRequirement: { type:
 *  "any" }` is a controller-chosen target, exactly like Cuombajj Witches'
 *  own ping, so the test wires it the same way `pushSpell`'s `targets`
 *  parameter does for a spell: no mid-resolution suspension involved. */
function activateAndPickTarget(
    state: GameState,
    treefolkId: string,
    target: TargetSelection
) {
    const act = pushSpell(state, mirrorwoodTreefolk.id, "p1", [target]);
    act.abilityId = REDIRECT_ABILITY_ID;
    act.id = treefolkId; // the ability's own stack item IS the source (ctx.sourceInstanceId)
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
        activateAndPickTarget(state, "mwt", { type: "permanent", id: "bear" });

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
        activateAndPickTarget(state, "mwt", { type: "player", id: "p2" });

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
        activateAndPickTarget(state, "mwt", { type: "player", id: "p2" });

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

    it("redirect destination removed from the battlefield before damage lands: damage goes on the Treefolk instead of vanishing (official ruling)", () => {
        // Scryfall/Gatherer ruling: "If the target creature is not on the
        // battlefield (or is not a creature) at the time the damage would be
        // redirected, then the damage goes on this card." Regression for
        // PR #1978 review Blocking 1: a naive redirect that rewrites
        // `current.target` to a dead instance id silently drops the damage
        // (dealDamage's `if (!found) return`) instead of landing it back on
        // the shielded creature.
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
        activateAndPickTarget(state, "mwt", { type: "permanent", id: "bear" });

        // The chosen destination leaves the battlefield (destroyed,
        // exiled, etc. — the mechanism doesn't matter, only that it's gone)
        // before the shielded damage is dealt.
        state.players[1].battlefield = [];
        state.players[1].graveyard = [...state.players[1].graveyard, bear];

        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "mwt" },
        ]);
        expect(resolveTopOfStack(state)).not.toBeNull();

        const mwtAfter = state.players[0].battlefield.find(
            (c) => c.id === "mwt"
        )!;
        // Damage lands on the Treefolk itself — not lost, not on the gone
        // destination.
        expect(mwtAfter.damageMarked).toBe(3);
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
        activateAndPickTarget(state, "mwt", { type: "permanent", id: "bear" });

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
