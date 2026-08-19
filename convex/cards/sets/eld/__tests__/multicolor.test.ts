// ELD — multicolor card behavior tests. Oko, Thief of Crowns is the set's
// first multicolor card (issue #2361): a loyalty-framework planeswalker
// (CR 606, ADR 0058) whose `+1` is a FIVE-layer continuous effect and whose
// `−5` is the first activated ability in the catalogue with two independently
// filtered target groups (`additionalTargetRequirements`).
//
// What is asserted here that the per-Op tests do NOT cover:
//   - the COMPOSITION of the five layer Ops on one permanent, in both target
//     shapes the Oracle line allows (a creature that has abilities, and a
//     NONCREATURE artifact), including the CR 613.4 ordering a naive
//     "overwrite the printed P/T" implementation gets wrong (7b set, then a
//     7c +1/+1 counter ON TOP);
//   - the CR 205.1a card-type replacement as OKO uses it — the elk-ified
//     artifact stops being an artifact, and the elk-ified permanent keeps its
//     supertypes;
//   - the `−5` exchange through the REAL announce path
//     (`activateAbilityOnState` → `applyOneTargetSelection` ×2), which is
//     where the "power 3 or less" restriction lives (CR 602.2b), plus the
//     CR 701.12b same-controller no-op driven straight at the Op list.

import { describe, it, expect } from "vitest";
import { oko } from "../multicolor";
import { getCardByName } from "../../../index";
import type { GameState, CardInstanceState } from "../../../../gre/state";
import { removePermanentTo, resolveTopOfStack } from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { getEffectiveActivatedAbilities } from "../../../../gre/activatedAbilities";
import { effectiveTriggeredAbilities } from "../../../../gre/copy";
import { hasSupertypeLive } from "../../../snowReads";
import { projectPublicState } from "../../../../gameProjections";
import {
    activateAbilityOnState,
    applyOneTargetSelection,
} from "../../../../game";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

const PLUS2 = "oko-thief-of-crowns-plus2";
const PLUS1 = "oko-thief-of-crowns-plus1";
const MINUS5 = "oko-thief-of-crowns-minus5";

const BEARS = getCardByName("Balduvian Bears").id; // vanilla 2/2
const SERRA = getCardByName("Serra Angel").id; // 4/4 flying, vigilance
const ORNITHOPTER = getCardByName("Ornithopter").id; // 0/2 artifact creature, flying
const LOTUS = getCardByName("Black Lotus").id; // noncreature artifact, mana ability

function okoOnBattlefield(loyalty = 4) {
    return makeInstance(oko.id, {
        id: "oko1",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
}

/** Pushes one of Oko's loyalty abilities on the stack with its targets already
 *  announced and resolves it through the real path. Loyalty-cost payment and
 *  target LEGALITY are exercised separately (through `activateAbilityOnState`
 *  in the `−5` block below); this drives resolution only. */
function activate(
    state: GameState,
    abilityId: string,
    targets?: { type: "permanent"; id: string }[]
): void {
    const oko1 = state.players[0].battlefield.find((c) => c.id === "oko1")!;
    state.stack.push({
        ...oko1,
        zone: "stack",
        castById: "p1",
        abilityId,
        ...(targets ? { targets } : {}),
    });
    resolveTopOfStack(state);
}

function find(state: GameState, id: string): CardInstanceState {
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === id);
        if (found) return found;
    }
    throw new Error(`no permanent ${id}`);
}

function controllerOf(state: GameState, id: string): string | undefined {
    for (const p of state.players) {
        if (p.battlefield.some((c) => c.id === id)) return p.id;
    }
    return undefined;
}

describe("Oko, Thief of Crowns — +2 Food token (CR 111.10b)", () => {
    it("creates one colorless Food artifact token with its printed ability", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [okoOnBattlefield()] }),
                makePlayer("p2"),
            ],
        });
        activate(state, PLUS2);
        const tokens = state.players[0].battlefield.filter(
            (c) => c.id !== "oko1"
        );
        expect(tokens).toHaveLength(1);
        const food = tokens[0];
        expect(food.types).toEqual(["Artifact"]);
        expect(food.subtypes).toEqual(["Food"]);
        // CR 111.10b — "{2}, {T}, Sacrifice this token: You gain 3 life."
        const abilities = getEffectiveActivatedAbilities(food);
        expect(abilities).toHaveLength(1);
        expect(abilities[0].ability.cost).toMatchObject({
            mana: { generic: 2 },
            tap: true,
            sacrifice: true,
        });
    });
});

describe("Oko, Thief of Crowns — +1 elk-ification (CR 611.2c, layers 4/5/6/7b)", () => {
    /** p1 has Oko; p2 has the permanent named `victim`. */
    function board(victim: CardInstanceState): GameState {
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [okoOnBattlefield()] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
    }

    it("strips every ability from a creature and makes it a green 3/3 Elk", () => {
        const state = board(
            makeInstance(SERRA, { id: "victim", controllerId: "p2" })
        );
        const before = find(state, "victim");
        expect(before.staticAbilities).toEqual(
            expect.arrayContaining(["flying", "vigilance"])
        );
        expect(getEffectivePower(state, before)).toBe(4);

        activate(state, PLUS1, [{ type: "permanent", id: "victim" }]);

        const after = find(state, "victim");
        // Layer 6 — CR 613.1f.
        expect(after.staticAbilities).toEqual([]);
        expect(getEffectiveActivatedAbilities(after)).toEqual([]);
        expect(effectiveTriggeredAbilities(after)).toEqual([]);
        // Layer 4 — CR 205.1a: card types replaced, subtype line replaced.
        expect(after.types).toEqual(["Creature"]);
        expect(after.subtypes).toEqual(["Elk"]);
        // Layer 5 — CR 613.1e: "It's just a green Elk."
        expect(after.colorOverride).toEqual(["G"]);
        // Layer 7b — CR 613.4b.
        expect(getEffectivePower(state, after)).toBe(3);
        expect(getEffectiveToughness(state, after)).toBe(3);
    });

    it("a +1/+1 counter still applies ON TOP of the base 3/3 (CR 613.4 — 7b then 7c)", () => {
        const state = board(
            makeInstance(BEARS, { id: "victim", controllerId: "p2" })
        );
        activate(state, PLUS1, [{ type: "permanent", id: "victim" }]);
        const elk = find(state, "victim");
        expect(getEffectivePower(state, elk)).toBe(3);
        // A counter added AFTER the elk-ification modifies the SET base value
        // rather than being overwritten by it — the shape a "write the printed
        // P/T" implementation passes its own naive test and gets wrong.
        elk.counters = { ...(elk.counters ?? {}), "+1/+1": 1 };
        expect(getEffectivePower(state, elk)).toBe(4);
        expect(getEffectiveToughness(state, elk)).toBe(4);
    });

    it("elk-ifies a NONCREATURE artifact, which stops being an artifact (CR 205.1a)", () => {
        const state = board(
            makeInstance(LOTUS, { id: "victim", controllerId: "p2" })
        );
        const before = find(state, "victim");
        expect(before.types).toEqual(["Artifact"]);
        expect(getEffectiveActivatedAbilities(before).length).toBeGreaterThan(
            0
        );

        activate(state, PLUS1, [{ type: "permanent", id: "victim" }]);

        const after = find(state, "victim");
        // The printed ruling: "The creature keeps any supertypes (such as
        // legendary) it has, but loses any other card types it has (such as
        // artifact)."
        expect(after.types).toEqual(["Creature"]);
        expect(after.types).not.toContain("Artifact");
        expect(after.subtypes).toEqual(["Elk"]);
        expect(getEffectiveActivatedAbilities(after)).toEqual([]);
        // It really is a 3/3 now — a permanent with no printed P/T at all.
        expect(getEffectivePower(state, after)).toBe(3);
        expect(getEffectiveToughness(state, after)).toBe(3);
    });

    it("an elk-ified ARTIFACT CREATURE keeps its supertypes and loses the artifact type", () => {
        const state = board(
            makeInstance(ORNITHOPTER, { id: "victim", controllerId: "p2" })
        );
        activate(state, PLUS1, [{ type: "permanent", id: "victim" }]);
        const after = find(state, "victim");
        expect(after.types).toEqual(["Creature"]);
        expect(after.staticAbilities).toEqual([]);
        // Ornithopter is not legendary; assert the supertype READ is live and
        // untouched rather than asserting a supertype it never had.
        expect(hasSupertypeLive(after, "Legendary")).toBe(false);
        expect(getEffectivePower(state, after)).toBe(3);
    });

    it("the strip does NOT survive a zone change — a bounced elk is a Serra Angel again (CR 400.7)", () => {
        const state = board(
            makeInstance(SERRA, { id: "victim", controllerId: "p2" })
        );
        activate(state, PLUS1, [{ type: "permanent", id: "victim" }]);
        expect(find(state, "victim").staticAbilities).toEqual([]);

        // CR 400.7 — the object that leaves is a new object with no memory of
        // its previous existence. The one-shot arm's holds are keyed to the
        // `"indefinite"` sentinel, which no `unapplySourceStaticEffects` call
        // can ever match, so `resetBattlefieldTransientState` is the ONLY
        // release path there is.
        removePermanentTo(state, "victim", "hand");
        const bounced = state.players[1].hand.find((c) => c.id === "victim")!;
        expect(bounced.staticAbilities).toEqual(
            expect.arrayContaining(["flying", "vigilance"])
        );
        expect(bounced.abilitiesSuppressedBy).toBeUndefined();
        expect(bounced.removedKeywords).toBeUndefined();
        // The type half (already covered for `setCardTypes`) restores in the
        // same pass — asserted here so the whole printed object comes back.
        expect(bounced.types).toEqual(["Creature"]);
        expect(bounced.subtypes).toEqual(["Angel"]);

        // Recast/reanimated: a full 4/4 flier again, abilities and all.
        bounced.zone = "battlefield";
        state.players[1].hand = state.players[1].hand.filter(
            (c) => c.id !== "victim"
        );
        state.players[1].battlefield.push(bounced);
        const reentered = find(state, "victim");
        expect(getEffectivePower(state, reentered)).toBe(4);
        expect(getEffectiveToughness(state, reentered)).toBe(4);
        expect(reentered.staticAbilities).toEqual(
            expect.arrayContaining(["flying", "vigilance"])
        );
    });

    it("the elk-ified permanent survives projection (wire format)", () => {
        const state = board(
            makeInstance(LOTUS, { id: "victim", controllerId: "p2" })
        );
        activate(state, PLUS1, [{ type: "permanent", id: "victim" }]);
        // The client sees only the projection: the layer-4 type line gates the
        // whole P/T pipeline (`isCreature`), and the layer-6 strip drives the
        // ability preview — both must cross the wire on the instance.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(slim.types).toEqual(["Creature"]);
        expect(slim.subtypes).toEqual(["Elk"]);
        expect(slim.colorOverride).toEqual(["G"]);
        expect(slim.staticAbilities).toEqual([]);
        expect(getEffectiveActivatedAbilities(slim)).toEqual([]);
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Oko, Thief of Crowns — −5 control exchange (CR 701.12b)", () => {
    /** p1: Oko + `mine`; p2: `theirs` (2/2) and `bigTheirs` (4/4). */
    function exchangeBoard(): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        okoOnBattlefield(5),
                        makeInstance(LOTUS, { id: "mine", controllerId: "p1" }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(BEARS, {
                            id: "theirs",
                            controllerId: "p2",
                        }),
                        makeInstance(SERRA, {
                            id: "bigTheirs",
                            controllerId: "p2",
                        }),
                    ],
                }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
    }

    it("swaps control of the two announced permanents", () => {
        const state = exchangeBoard();
        activate(state, MINUS5, [
            { type: "permanent", id: "mine" },
            { type: "permanent", id: "theirs" },
        ]);
        expect(controllerOf(state, "mine")).toBe("p2");
        expect(controllerOf(state, "theirs")).toBe("p1");
    });

    it("does nothing when both permanents are already controlled by one player (CR 701.12b)", () => {
        // Not reachable through the announce filters ("you control" /
        // "an opponent controls"), so it is driven straight at the resolved Op
        // list: the two `gainControl` writes must cancel out rather than
        // producing a one-way steal.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        okoOnBattlefield(5),
                        makeInstance(LOTUS, { id: "mine", controllerId: "p1" }),
                        makeInstance(BEARS, {
                            id: "alsoMine",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        activate(state, MINUS5, [
            { type: "permanent", id: "mine" },
            { type: "permanent", id: "alsoMine" },
        ]);
        expect(controllerOf(state, "mine")).toBe("p1");
        expect(controllerOf(state, "alsoMine")).toBe("p1");
    });

    it("refuses to ANNOUNCE when the second group is unfillable, before any pendingTarget is set (CR 601.2c via 602.2b)", () => {
        // The opponent's only creature is a 4/4 — group 1 ("power 3 or less")
        // has zero legal candidates. Group 0 is fillable, so without the
        // per-extra-group legality loop in `activateAbilityOnState` the
        // activation would be accepted, strand the player on group 0's
        // `pendingTarget`, and dead-end with a second slot nothing can fill.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        okoOnBattlefield(5),
                        makeInstance(LOTUS, { id: "mine", controllerId: "p1" }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(SERRA, {
                            id: "bigTheirs",
                            controllerId: "p2",
                        }),
                    ],
                }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "oko1",
                abilityId: MINUS5,
            })
        ).toThrow(/legal targets/);
        // The throw must land BEFORE the announcement commits anything.
        expect(state.pendingTarget).toBeUndefined();
        // CR 606.5 — and before the loyalty cost is paid.
        expect(find(state, "oko1").counters?.loyalty).toBe(5);
    });

    it("announces two INDEPENDENT target groups and rejects a power-4 creature for the second (CR 602.2b)", () => {
        const state = exchangeBoard();
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "oko1",
            abilityId: MINUS5,
        });
        // Group 0 — "target artifact or creature YOU control".
        expect(state.pendingTarget).toBeDefined();
        expect(state.pendingTarget!.controller).toBe("you");
        applyOneTargetSelection(state, "p1", {
            targetType: "permanent",
            targetId: "mine",
        });
        // Group 1 swapped in — "target creature AN OPPONENT controls with
        // power 3 or less". Both the controller AND the power bound differ
        // from group 0, which no shipped spell-side caller exercises.
        expect(state.pendingTarget).toBeDefined();
        expect(state.pendingTarget!.controller).toBe("opponent");
        expect(state.pendingTarget!.powerFilter).toEqual({ max: 3 });
        // The 4/4 is an illegal pick — the filter bites at ANNOUNCEMENT.
        expect(() =>
            applyOneTargetSelection(state, "p1", {
                targetType: "permanent",
                targetId: "bigTheirs",
            })
        ).toThrow();
        // The legal 2/2 completes the announcement and the ability goes on the
        // stack with BOTH groups' picks, in declaration order.
        applyOneTargetSelection(state, "p1", {
            targetType: "permanent",
            targetId: "theirs",
        });
        const item = state.stack.find((s) => s.abilityId === MINUS5)!;
        expect(item.targets).toEqual([
            { type: "permanent", id: "mine" },
            { type: "permanent", id: "theirs" },
        ]);
        // CR 606.5 — the −5 was paid out of the five loyalty counters.
        expect(find(state, "oko1").counters?.loyalty).toBe(0);
        resolveTopOfStack(state);
        expect(controllerOf(state, "mine")).toBe("p2");
        expect(controllerOf(state, "theirs")).toBe("p1");
    });
});
