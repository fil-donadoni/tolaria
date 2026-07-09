// TOR (Torment) — red cards. Grim Lavamancer (issue #987, parent PRD #979).
//
// Grim Lavamancer introduces `owner: "you"` on the exileFromGraveyard
// activation cost (CR 118.5 — "Exile two cards from YOUR graveyard"), a
// generalization of the existing Night Soil cost (any single graveyard). The
// project has no convex-test harness (ADR 0001), so the production
// mutation-handler cost logic (activate legality's `canPayExileFromGraveyard`
// + `selectActivationExileCost`'s owner/single-graveyard/count checks) is
// mirrored here as a pure function that keeps the SAME branch order and gating
// game.ts uses, then drives the REAL exported GRE `resolveTopOfStack` for the
// dealDamage half. A divergence (letting the cost be paid from an opponent's
// graveyard, forgetting to exile the cards, or the wrong damage) fails here.

import { describe, it, expect } from "vitest";
import {
    getPlayer,
    moveCard,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import type { TargetSelection } from "../../../types";
import { projectPublicState } from "../../../../gameProjections";
import { grimLavamancer } from "../red";
import { grizzlyBears } from "../../lea";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

const ABILITY_ID = "grim-lavamancer-bolt";

/** Mirror of game.ts `canPayExileFromGraveyard`, including the `owner: "you"`
 *  restriction: when `restrictOwnerId` is set only that player's graveyard is
 *  an eligible source (CR 118.5), else any player's. */
function canPayExileFromGraveyard(
    state: GameState,
    count: number,
    restrictOwnerId?: string
): boolean {
    const sources =
        restrictOwnerId !== undefined
            ? state.players.filter((p) => p.id === restrictOwnerId)
            : state.players;
    return sources.some((p) => p.graveyard.length >= count);
}

/** Mirror of the exile-cost payment: enforce single-graveyard + exact count +
 *  the `owner: "you"` restriction, then move the picked cards graveyard →
 *  exile (deferred-then-committed in production). Throws exactly where the
 *  mutation throws. */
function payExileFromOwnGraveyard(
    state: GameState,
    activatorId: string,
    graveyardOwnerId: string,
    cardInstanceIds: string[]
): void {
    const ability = grimLavamancer.activatedAbilities!.find(
        (a) => a.id === ABILITY_ID
    )!;
    const cost = ability.cost.exileFromGraveyard!;
    // CR 118.5 — owner: "you" restricts the source to the activator's graveyard.
    if (cost.owner === "you" && graveyardOwnerId !== activatorId) {
        throw new Error("This cost must be paid from your own graveyard");
    }
    if (cardInstanceIds.length !== cost.count) {
        throw new Error(`Must exile exactly ${cost.count} cards`);
    }
    const owner = getPlayer(state, graveyardOwnerId);
    for (const id of cardInstanceIds) {
        if (!owner.graveyard.some((c) => c.id === id)) {
            throw new Error("Selected card is not in the chosen graveyard");
        }
    }
    for (const id of cardInstanceIds) moveCard(owner, id, "graveyard", "exile");
}

/** Pushes Grim Lavamancer's ability on the stack (source stays on the
 *  battlefield) with the chosen target and resolves it. */
function resolveBolt(
    state: GameState,
    source: CardInstanceState,
    target: TargetSelection
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId: ABILITY_ID,
        targets: [target],
    });
    resolveTopOfStack(state);
}

function fuel(id: string, ownerId: string): CardInstanceState {
    return makeInstance(grizzlyBears.id, {
        id,
        ownerId,
        controllerId: ownerId,
        zone: "graveyard",
    });
}

function setup(overrides?: {
    ownGraveyard?: CardInstanceState[];
    oppGraveyard?: CardInstanceState[];
}) {
    const lavamancer = makeInstance(grimLavamancer.id, {
        id: "lava",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [lavamancer],
                graveyard: overrides?.ownGraveyard ?? [],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
            makePlayer("p2", {
                graveyard: overrides?.oppGraveyard ?? [],
            }),
        ],
    });
}

describe("Grim Lavamancer ({R},{T}, exile 2 from your graveyard: 2 to any target — CR 605 / 118.5 / 120.1)", () => {
    it("declares the graveyard-exile activation cost + dealDamage effect", () => {
        const ability = grimLavamancer.activatedAbilities?.[0];
        expect(ability?.id).toBe(ABILITY_ID);
        expect(ability?.cost.mana).toEqual({ R: 1 });
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.cost.exileFromGraveyard).toEqual({
            count: 2,
            owner: "you",
        });
        expect(ability?.useStack).toBe(true);
        expect(ability?.targetRequirement?.type).toBe("any");
        expect(ability?.effects).toEqual([
            { op: "dealDamage", amount: 2, to: { target: 0 } },
        ]);
        expect(grimLavamancer.manaCost).toEqual({ R: 1 });
        expect(grimLavamancer.power).toBe(1);
        expect(grimLavamancer.toughness).toBe(1);
    });

    it("exiles two cards from your graveyard and deals 2 to a player", () => {
        const state = setup({
            ownGraveyard: [
                fuel("g1", "p1"),
                fuel("g2", "p1"),
                fuel("g3", "p1"),
            ],
        });
        expect(canPayExileFromGraveyard(state, 2, "p1")).toBe(true);
        payExileFromOwnGraveyard(state, "p1", "p1", ["g1", "g2"]);

        // Cost paid: exactly the two picked cards moved to exile.
        expect(getPlayer(state, "p1").graveyard.map((c) => c.id)).toEqual([
            "g3",
        ]);
        expect(
            (getPlayer(state, "p1").exile ?? []).map((c) => c.id).sort()
        ).toEqual(["g1", "g2"]);

        // Effect resolves: 2 damage to the target player.
        resolveBolt(state, getPlayer(state, "p1").battlefield[0], {
            type: "player",
            id: "p2",
        });
        expect(getPlayer(state, "p2").life).toBe(18);
    });

    it("kills a 2-toughness creature with the 2 damage", () => {
        const state = setup({
            ownGraveyard: [fuel("g1", "p1"), fuel("g2", "p1")],
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        getPlayer(state, "p2").battlefield.push(bear);
        payExileFromOwnGraveyard(state, "p1", "p1", ["g1", "g2"]);
        resolveBolt(state, getPlayer(state, "p1").battlefield[0], {
            type: "permanent",
            id: "bear",
        });
        expect(
            getPlayer(state, "p2").battlefield.map((c) => c.id)
        ).not.toContain("bear");
        expect(getPlayer(state, "p2").graveyard.map((c) => c.id)).toContain(
            "bear"
        );
    });

    it("is illegal to activate with fewer than two cards in your graveyard", () => {
        const state = setup({ ownGraveyard: [fuel("g1", "p1")] });
        expect(canPayExileFromGraveyard(state, 2, "p1")).toBe(false);
    });

    it("cannot pay the cost from an opponent's graveyard (owner: 'you', CR 118.5)", () => {
        const state = setup({
            // Only the opponent has cards — with owner: "you" the cost is
            // unpayable even though a graveyard holds enough.
            oppGraveyard: [fuel("o1", "p2"), fuel("o2", "p2")],
        });
        expect(canPayExileFromGraveyard(state, 2, "p1")).toBe(false);
        expect(() =>
            payExileFromOwnGraveyard(state, "p1", "p2", ["o1", "o2"])
        ).toThrow(/your own graveyard/i);
    });

    it("keeps the 2-damage board-visible across the wire projection", () => {
        const state = setup({
            ownGraveyard: [fuel("g1", "p1"), fuel("g2", "p1")],
        });
        payExileFromOwnGraveyard(state, "p1", "p1", ["g1", "g2"]);
        resolveBolt(state, getPlayer(state, "p1").battlefield[0], {
            type: "player",
            id: "p2",
        });
        const projected = projectPublicState(state, 1, "p1");
        const p2 = projected.players.find((p) => p.id === "p2")!;
        expect(p2.life).toBe(18);
    });
});
