// PLS (Planeshift) — green card behavior tests (ADR 0043 colour split).
// Each card's describe block cites the CR section it exercises.
import { describe, it, expect } from "vitest";
import { mirrorwoodTreefolk, quirionExplorer } from "../green";
import { crawWurm } from "../../lea/green";
import { lightningBolt } from "../../lea/red";
import { forest, island, mountain, swamp } from "../../lea/colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { resolveTopOfStack } from "../../../../gre/state";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import {
    getEffectiveManaChoices,
    getManaTapOptionsDetailed,
} from "../../../../gre/constants";
import { getLegalActions } from "../../../../gre/rules";
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

// ─────────────────────────────────────────────────────────────────────────────
// C6 — Board-derived restricted-colour mana abilities (CR 605.1a, issue #1941).
// Quirion Explorer's `manaColorSource` descriptor is evaluated by
// `boardDerivedManaChoices` (`gre/constants.ts`); the assertions below drive
// the SAME authorities every consumer reads — `getEffectiveManaChoices` (the
// picker/index authority), `getManaTapOptionsDetailed` (the payment-option
// enumerator) and `getLegalActions` (the castability gate) — rather than the
// descriptor in isolation.
// ─────────────────────────────────────────────────────────────────────────────

/** The `battlefields` argument every board-derived mana consumer takes. */
function boards(state: GameState) {
    return state.players.map((p) => ({
        playerId: p.id,
        battlefield: p.battlefield,
    }));
}

function choicesFor(
    state: GameState,
    source: CardInstanceState,
    controllerId: string
) {
    return getEffectiveManaChoices(source, controllerId, boards(state));
}

describe("Quirion Explorer (CR 605.1a / 106.4 — colours an OPPONENT's land could produce)", () => {
    it("is a {1}{G} 1/1 Elf Druid Scout with the modern oracle text", () => {
        expect(quirionExplorer.manaCost).toEqual({ X: 1, G: 1 });
        expect(quirionExplorer.types).toEqual(["Creature"]);
        expect(quirionExplorer.subtypes).toEqual(["Elf", "Druid", "Scout"]);
        expect(quirionExplorer.power).toBe(1);
        expect(quirionExplorer.toughness).toBe(1);
        expect(quirionExplorer.oracleText).toBe(
            "{T}: Add one mana of any color that a land an opponent controls could produce."
        );
    });

    it("is a mana ability — resolves immediately, never uses the stack (CR 605.3a)", () => {
        const ability = quirionExplorer.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.cost).toEqual({ tap: true });
    });

    it("reads the OPPONENT's lands, not its controller's", () => {
        const elf = makeInstance(quirionExplorer.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                // p1's own Mountain must NOT contribute {R}.
                makePlayer("p1", {
                    battlefield: [
                        elf,
                        makeInstance(mountain.id, { controllerId: "p1" }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(forest.id, { controllerId: "p2" }),
                        makeInstance(island.id, { controllerId: "p2" }),
                    ],
                }),
            ],
        });
        expect(choicesFor(state, elf, "p1")).toEqual([{ U: 1 }, { G: 1 }]);
    });

    it("offers nothing — and no tap option — when the opponent controls no colour-producing land", () => {
        const elf = makeInstance(quirionExplorer.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elf] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        expect(choicesFor(state, elf, "p1")).toEqual([]);
        // The empty scope must not surface as a false affordance: the unified
        // tap-option list (what the picker renders and the planner taps) is
        // empty too, rather than falling back to the static five-colour list.
        expect(
            getManaTapOptionsDetailed(elf, "p1", boards(state))
        ).toHaveLength(0);
    });

    it("tracks the board — a land entering the opponent's side changes the offer", () => {
        const elf = makeInstance(quirionExplorer.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elf] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        expect(choicesFor(state, elf, "p1")).toEqual([]);
        state.players[1].battlefield.push(
            makeInstance(swamp.id, { controllerId: "p2" })
        );
        expect(choicesFor(state, elf, "p1")).toEqual([{ B: 1 }]);
    });

    it("the restricted colour set is visible to the castability gate", () => {
        const bolt = makeInstance(lightningBolt.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const elf = makeInstance(quirionExplorer.id, { controllerId: "p1" });
        // p1 has NO mana source of its own — Bolt's {R} can only come from
        // Quirion Explorer reading p2's board.
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [bolt], battlefield: [elf] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(mountain.id, { controllerId: "p2" }),
                    ],
                }),
            ],
        });
        expect(getLegalActions(state, state.players[0], bolt)).toContain(
            "cast"
        );

        // …and a scope that cannot produce {R} correctly reports NOT castable,
        // instead of leaning on the five-colour fallback.
        state.players[1].battlefield = [
            makeInstance(island.id, { controllerId: "p2" }),
        ];
        expect(getLegalActions(state, state.players[0], bolt)).not.toContain(
            "cast"
        );
    });

    it("survives the wire projection — the client's picker matches the server's list", () => {
        const elf = makeInstance(quirionExplorer.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elf] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(forest.id, { controllerId: "p2" }),
                        makeInstance(swamp.id, { controllerId: "p2" }),
                    ],
                }),
            ],
        });
        const onFat = choicesFor(state, elf, "p1");
        expect(onFat).toEqual([{ B: 1 }, { G: 1 }]);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === elf.id
        )! as unknown as CardInstanceState;
        expect(
            getEffectiveManaChoices(
                slim,
                "p1",
                projected.players.map((p) => ({
                    playerId: p.id,
                    battlefield:
                        p.battlefield as unknown as CardInstanceState[],
                }))
            )
        ).toEqual(onFat);
    });
});
