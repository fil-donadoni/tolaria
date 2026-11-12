// nph black — Dismember. Exercises the Phyrexian-mana CAST path end to end
// (announce → finalizeTargetSelection → commit → resolve): the -5/-5 effect (a
// reused `pump` Op) plus the {B/P}{B/P} pip payment resolved as life or mana
// (CR 107.4f). The generic cost-system pieces are covered in
// convex/gre/__tests__/phyrexian.test.ts.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    submitChoice,
} from "../../../__tests__/setup.helper";
import { finalizeTargetSelection } from "../../../../game";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";
import { preloadDefinitions } from "../../../registry";
import { surgicalExtraction } from "../black.cards";

const dismember = getDefinition("064dfdeb-485f-473e-9fa0-8fdb7638cdc6");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

function setup(opts: {
    life: number;
    manaPool?: Partial<Record<"W" | "U" | "B" | "R" | "G" | "C", number>>;
    phyrexianLifePips?: number;
}) {
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear",
        controllerId: "p2",
        ownerId: "p2",
        power: 6,
        toughness: 6,
    });
    const spell = makeInstance(dismember.id, {
        id: "dismember",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                life: opts.life,
                hand: [spell],
                manaPool: {
                    W: 0,
                    U: 0,
                    B: 0,
                    R: 0,
                    G: 0,
                    C: 0,
                    ...opts.manaPool,
                },
            }),
            makePlayer("p2", { battlefield: [bear] }),
        ],
    });
    state.pendingTarget = {
        playerId: "p1",
        cardInstanceId: "dismember",
        targetType: "Creature",
        count: 1,
        selected: [{ type: "permanent", id: "bear" }],
        ...(opts.phyrexianLifePips !== undefined
            ? { phyrexianLifePips: opts.phyrexianLifePips }
            : {}),
    };
    finalizeTargetSelection(state, state.pendingTarget!, "p1");
    return state;
}

describe("Dismember (-5/-5, {1}{B/P}{B/P}, CR 107.4f)", () => {
    it("default split pays both {B/P} with life and gives -5/-5", () => {
        // 20 life, only {C} for the {1} generic → both Phyrexian pips paid with
        // 4 life; the target (6/6) becomes 1/1.
        const state = setup({ life: 20, manaPool: { C: 1 } });
        expect(state.players[0].life).toBe(16); // 20 - 2 pips × 2 life
        resolveTopOfStack(state);
        const bear = state.players[1].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(1);
        expect(getEffectiveToughness(state, bear)).toBe(1);
    });

    it("explicit phyrexianLifePips:0 pays the pips with {B} mana, no life lost", () => {
        // 20 life, pool {C}{B}{B} → {1} from {C}, each {B/P} from {B}, 0 life.
        const state = setup({
            life: 20,
            manaPool: { C: 1, B: 2 },
            phyrexianLifePips: 0,
        });
        expect(state.players[0].life).toBe(20);
        expect(state.players[0].manaPool.B).toBe(0);
        resolveTopOfStack(state);
        const bear = state.players[1].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectiveToughness(state, bear)).toBe(1);
    });

    it("wire format: the -5/-5 survives projection (mandatory)", () => {
        const state = setup({ life: 20, manaPool: { C: 1 } });
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 2, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(1);
    });
});

// Surgical Extraction (CR 115.1 announced graveyard target, CR 201.2 same-name
// sweep, CR 701.23a library search, CR 108.3 owner): the sweep follows the
// OWNER of the targeted graveyard card, never the caster.
describe("Surgical Extraction", () => {
    // A clean tree's registry lacks a new hand-written card until the queue
    // regenerates the catalogue, so the test preloads it.
    const surgical = surgicalExtraction();
    preloadDefinitions([surgical]);
    const bearAt = (
        id: string,
        owner: "p1" | "p2",
        zone: "hand" | "graveyard" | "library"
    ) =>
        makeInstance(grizzlyBears.id, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone,
        });

    it("exiles every same-named card from the target's owner's graveyard, hand and library, never the caster's", () => {
        const target = bearAt("se-gy", "p2", "graveyard");
        const mine = bearAt("se-mine", "p1", "hand");
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [mine] }),
                makePlayer("p2", {
                    graveyard: [target],
                    hand: [bearAt("se-hand", "p2", "hand")],
                    library: [bearAt("se-lib", "p2", "library")],
                }),
            ],
        });
        pushSpell(state, surgical.id, "p1", [
            { type: "graveyard-card", id: "se-gy", playerId: "p2" },
        ]);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search

        const search = state.pendingChoices![0];
        expect(search.kind).toBe("search-library");
        expect(search.zoneOwnerId).toBe("p2");
        expect(search.candidateIds).toEqual(["se-lib"]);
        submitChoice(state, ["se-lib"]);

        expect(state.players[1].exile.map((c) => c.id).sort()).toEqual([
            "se-gy",
            "se-hand",
            "se-lib",
        ]);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].library).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["se-mine"]);
        expect(state.players[0].exile).toHaveLength(0);
    });

    it("targets the caster's own graveyard card and sweeps the caster's zones", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [bearAt("se-own", "p1", "graveyard")],
                    hand: [bearAt("se-own-hand", "p1", "hand")],
                }),
                makePlayer("p2", { hand: [bearAt("se-theirs", "p2", "hand")] }),
            ],
        });
        pushSpell(state, surgical.id, "p1", [
            { type: "graveyard-card", id: "se-own", playerId: "p1" },
        ]);
        expect(resolveTopOfStack(state)).toBeNull();
        submitChoice(state, []);

        expect(state.players[0].exile.map((c) => c.id).sort()).toEqual([
            "se-own",
            "se-own-hand",
        ]);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["se-theirs"]);
    });
});
