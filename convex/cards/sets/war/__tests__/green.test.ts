// war (War of the Spark) — green behavior tests (ADR 0043 colour split).
//
// Nissa, Who Shakes the World (issue #3229). Two of her three lines are new
// ground and get assertions; the −8 fetch rides the shipped tutor shape.
//   * the mana clause is the FIRST `tappedTrigger` whose body is an Effect
//     Script rather than a `resolve` callback (every prior one — Mana Flare,
//     Fertile Ground, Wild Growth, Badgermole Cub — must read the tapped
//     permanent's controller or its `manaProduced`, tracked-by: #2153; Nissa's
//     recipient is her own controller and the amount is fixed). It is asserted
//     through `emitPermanentTapped` + the real trigger pass, so the CR 605.4
//     off-stack resolution is what produces the mana, not a hand-driven body.
//   * the +1's ORDER — counters, then untap, then an INDEFINITE animation. The
//     land must end as a 3/3 land creature that is still a land and still taps
//     for mana (CR 205.1b), which is the whole point of the card.

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { GameState } from "../../../../gre/state";
import {
    emitPermanentTapped,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import {
    getLegalTargets,
    targetingSourceFromCard,
} from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";
import { NISSA_WHO_SHAKES_THE_WORLD_EMBLEM_ID } from "../../../emblems";
import type { TargetSelection } from "../../../types";

const nissa = getDefinition("f857bbe4-5619-4733-a0c7-69700f2ef4f3");
const forest = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b");
const mishrasFactory = getDefinition("a696c5b6-f216-454d-8029-74e84bbd1428");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

const FOREST_MANA = "nissa-who-shakes-the-world-forest-mana";
const PLUS1 = "nissa-who-shakes-the-world-plus1";
const MINUS8 = "nissa-who-shakes-the-world-minus8";

function nissaOnBattlefield(loyalty = 5) {
    return makeInstance(nissa.id, {
        id: "nissa1",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
}

/** Pushes one of Nissa's loyalty abilities on the stack and resolves it through
 *  the real path (the loyalty COST is exercised in game.ts; the card test
 *  asserts the EFFECT — the Chandra harness). */
function activate(
    state: GameState,
    abilityId: string,
    targets?: TargetSelection[]
): void {
    const source = state.players[0].battlefield.find((c) => c.id === "nissa1")!;
    state.stack.push({
        ...source,
        zone: "stack",
        castById: "p1",
        abilityId,
        ...(targets ? { targets } : {}),
    });
    resolveTopOfStack(state);
}

describe("Nissa, Who Shakes the World — Forest mana doubling (CR 605.1b / 605.4)", () => {
    function boardWithForest(controllerId: "p1" | "p2"): GameState {
        const land = makeInstance(forest.id, {
            id: "forest1",
            controllerId,
            ownerId: controllerId,
        });
        const players = [
            makePlayer("p1", { battlefield: [nissaOnBattlefield()] }),
            makePlayer("p2"),
        ];
        players[controllerId === "p1" ? 0 : 1].battlefield.push(land);
        return makeState({ players });
    }

    it("adds an extra {G} to Nissa's controller's pool, off the stack (CR 605.4)", () => {
        const state = boardWithForest("p1");
        const land = state.players[0].battlefield.find(
            (c) => c.id === "forest1"
        )!;
        state.players[0].manaPool = { G: 1 };
        emitPermanentTapped(state, land, true, { G: 1 });
        processPendingActionTriggers(state);

        // CR 605.4 — a triggered MANA ability never uses the stack.
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].manaPool?.G).toBe(2);
    });

    it("does NOT fire on a non-Forest land, nor on a Forest an OPPONENT taps", () => {
        const factoryBoard = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        nissaOnBattlefield(),
                        makeInstance(mishrasFactory.id, {
                            id: "factory",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const factory = factoryBoard.players[0].battlefield.find(
            (c) => c.id === "factory"
        )!;
        factoryBoard.players[0].manaPool = { C: 1 };
        emitPermanentTapped(factoryBoard, factory, true, { C: 1 });
        processPendingActionTriggers(factoryBoard);
        expect(factoryBoard.players[0].manaPool?.G ?? 0).toBe(0);

        const oppBoard = boardWithForest("p2");
        const oppForest = oppBoard.players[1].battlefield.find(
            (c) => c.id === "forest1"
        )!;
        emitPermanentTapped(oppBoard, oppForest, true, { G: 1 });
        processPendingActionTriggers(oppBoard);
        expect(oppBoard.players[0].manaPool?.G ?? 0).toBe(0);
        expect(oppBoard.players[1].manaPool?.G ?? 0).toBe(0);
    });

    it("does NOT fire on a NON-mana tap of a Forest (CR 605.1)", () => {
        const state = boardWithForest("p1");
        const land = state.players[0].battlefield.find(
            (c) => c.id === "forest1"
        )!;
        emitPermanentTapped(state, land, false);
        processPendingActionTriggers(state);
        expect(state.players[0].manaPool?.G ?? 0).toBe(0);
    });

    it("declares the bonus to the PREDICTIVE potential-mana models (CR 605.4)", () => {
        const trigger = (nissa.triggeredAbilities ?? []).find(
            (a) => a.id === FOREST_MANA
        )!;
        expect(trigger.manaAbility).toBe(true);
        expect(trigger.manaBonusForPotential).toEqual({
            appliesTo: { filter: { subtypes: "Forest" } },
            amount: { kind: "fixed", mana: { G: 1 } },
        });
    });
});

describe("Nissa, Who Shakes the World — +1 animates a noncreature land (CR 205.1b / 613.4)", () => {
    function boardWithLands(): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        nissaOnBattlefield(),
                        makeInstance(forest.id, {
                            id: "forest1",
                            controllerId: "p1",
                            ownerId: "p1",
                            isTapped: true,
                        }),
                        makeInstance(grizzlyBears.id, {
                            id: "bears",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(forest.id, {
                            id: "oppForest",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
    }

    /** The +1's legal target ids, read through the SAME authority the mutation
     *  and the client both use (`getLegalTargets`, ADR 0068). */
    function plus1TargetIds(state: GameState): string[] {
        const source = state.players[0].battlefield.find(
            (c) => c.id === "nissa1"
        )!;
        const req = (nissa.activatedAbilities ?? []).find(
            (a) => a.id === PLUS1
        )!.targetRequirement!;
        return getLegalTargets(
            state,
            req,
            targetingSourceFromCard(source, false),
            "p1"
        )
            .filter((t) => t.type === "permanent")
            .map((t) => t.id)
            .sort();
    }

    it("only lands YOU CONTROL are legal targets — a creature and the opponent's land are not", () => {
        const state = boardWithLands();
        expect(plus1TargetIds(state)).toEqual(["forest1"]);
    });

    it("a land that is ALREADY a creature is not a legal target (CR 205 — 'noncreature land')", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        nissaOnBattlefield(),
                        makeInstance(forest.id, {
                            id: "forest1",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        makeInstance(forest.id, {
                            id: "forest2",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(plus1TargetIds(state)).toEqual(["forest1", "forest2"]);
        // Animate one of them with the +1 itself: it becomes a land CREATURE,
        // and a second +1 can no longer choose it.
        activate(state, PLUS1, [{ type: "permanent", id: "forest1" }]);
        expect(plus1TargetIds(state)).toEqual(["forest2"]);
    });

    it("puts three counters, untaps, and makes it a 3/3 Elemental land creature with vigilance and haste", () => {
        const state = boardWithLands();
        activate(state, PLUS1, [{ type: "permanent", id: "forest1" }]);

        const land = state.players[0].battlefield.find(
            (c) => c.id === "forest1"
        )!;
        expect(land.counters?.["+1/+1"]).toBe(3);
        expect(land.isTapped).toBe(false);
        // CR 205.1b — the Creature type is ADDED; it is still a land, and still
        // a Forest, so it still taps for {G} (and still triggers the mana
        // clause above).
        expect(land.types).toContain("Creature");
        expect(land.types).toContain("Land");
        expect(land.subtypes).toContain("Forest");
        expect(land.subtypes).toContain("Elemental");
        // CR 613.4 — a 0/0 base with three +1/+1 counters is a 3/3, so the
        // animated land never exists as a 0/0 the SBAs could bury.
        expect(getEffectivePower(state, land)).toBe(3);
        expect(getEffectiveToughness(state, land)).toBe(3);

        // SURFACE assertion through the reducer the client actually reads.
        const wire = projectPublicState(
            state,
            "p1"
        ).players[0].battlefield.find((c) => c.id === "forest1")!;
        expect(wire.types).toContain("Creature");
        expect(wire.types).toContain("Land");
        expect(wire.subtypes).toContain("Elemental");
        expect(wire.staticAbilities).toContain("vigilance");
        expect(wire.staticAbilities).toContain("haste");
        expect(wire.counters?.["+1/+1"]).toBe(3);
    });

    it('an animated Forest still triggers the mana clause — "still a land" is load-bearing', () => {
        const state = boardWithLands();
        activate(state, PLUS1, [{ type: "permanent", id: "forest1" }]);
        const land = state.players[0].battlefield.find(
            (c) => c.id === "forest1"
        )!;
        state.players[0].manaPool = { G: 1 };
        emitPermanentTapped(state, land, true, { G: 1 });
        processPendingActionTriggers(state);
        expect(state.players[0].manaPool?.G).toBe(2);
    });

    it('"up to one" resolves harmlessly with no target chosen (CR 608.2b)', () => {
        const state = boardWithLands();
        activate(state, PLUS1, []);
        const land = state.players[0].battlefield.find(
            (c) => c.id === "forest1"
        )!;
        expect(land.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(land.types).not.toContain("Creature");
        expect(land.isTapped).toBe(true);
    });
});

describe("Nissa, Who Shakes the World — −8 emblem + Forest fetch (CR 114 / 701.23)", () => {
    it("creates the indestructible-lands emblem and offers every Forest card in the library", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        nissaOnBattlefield(8),
                        makeInstance(forest.id, {
                            id: "bfForest",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                    library: [
                        makeInstance(forest.id, {
                            id: "libForest1",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                        makeInstance(forest.id, {
                            id: "libForest2",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                        makeInstance(mishrasFactory.id, {
                            id: "libFactory",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        activate(state, MINUS8);

        expect(state.emblems).toHaveLength(1);
        expect(state.emblems![0]).toMatchObject({
            ownerId: "p1",
            emblemId: NISSA_WHO_SHAKES_THE_WORLD_EMBLEM_ID,
        });
        const choice = state.pendingChoices![0];
        expect(choice.kind).toBe("search-library");
        expect([...(choice.candidateIds ?? [])].sort()).toEqual([
            "libForest1",
            "libForest2",
        ]);
    });

    it("the emblem grants indestructible to the owner's lands only (CR 114.3)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        nissaOnBattlefield(8),
                        makeInstance(forest.id, {
                            id: "myForest",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        makeInstance(grizzlyBears.id, {
                            id: "bears",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(forest.id, {
                            id: "oppForest",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        activate(state, MINUS8);

        const wire = projectPublicState(state, "p1");
        const mine = wire.players[0].battlefield.find(
            (c) => c.id === "myForest"
        )!;
        const bears = wire.players[0].battlefield.find(
            (c) => c.id === "bears"
        )!;
        const theirs = wire.players[1].battlefield.find(
            (c) => c.id === "oppForest"
        )!;
        expect(mine.staticAbilities).toContain("indestructible");
        expect(bears.staticAbilities ?? []).not.toContain("indestructible");
        expect(theirs.staticAbilities ?? []).not.toContain("indestructible");
    });
});
