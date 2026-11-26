// Per-card behavior tests for colorless cards in
// `convex/cards/sets/acr/colorless.cards.ts` (Assassin's Creed, split by
// colour per ADR 0043). Abstergo Entertainment rides the CR 700.6 "historic"
// union (`HISTORIC_FILTER`) — the supertype axis of `typeOrSubtypeFilter`
// over a graveyard CARD target — so the path is walked whole: activation
// through `game.ts`, the offered set (`getLegalTargets`), the accepted set
// (`applyOneTargetSelection`) and resolution. The client mirror over the
// real wire projection is `src/lib/__tests__/historic-graveyard-target.test.ts`.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup.helper";
import {
    activateAbilityOnState,
    advanceTargetGroupOrFinalize,
    applyOneTargetSelection,
} from "../../../../game";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { resolveTopOfStack } from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";
import { abstergoEntertainment as abstergoFactory } from "../colorless.cards";

const abstergoEntertainment = abstergoFactory();

const RECOVER = "abstergo-entertainment-recover";
const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // not historic
const MEMNITE = "469cc4e0-49c0-4009-97ea-28e44addec69"; // artifact
const LUTRI = "fb1189c9-7842-466e-8238-1e02677d8494"; // legendary
const FABLE = "24c0d87b-0049-4beb-b9cb-6f813b7aa7dc"; // Saga

function card(cardId: string, id: string, owner: "p1" | "p2") {
    return makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        isSummoningSick: false,
    });
}

function board(): GameState {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [card(abstergoEntertainment.id, "abstergo", "p1")],
                graveyard: [
                    card(BEARS, "bears", "p1"),
                    card(MEMNITE, "memnite", "p1"),
                    card(LUTRI, "lutri", "p1"),
                    card(FABLE, "fable", "p1"),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 },
            }),
            makePlayer("p2", {
                graveyard: [
                    card(MEMNITE, "their-memnite", "p2"),
                    card(BEARS, "their-bears", "p2"),
                ],
            }),
        ],
    });
}

function activate(state: GameState): void {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "abstergo",
        abilityId: RECOVER,
    });
}

const ids = (zone: { id: string }[]) => zone.map((c) => c.id).sort();

describe("Abstergo Entertainment — historic recursion, then exile all graveyards (CR 700.6, CR 608.2b)", () => {
    it("offers exactly the historic cards in your graveyard — artifact, legendary, Saga (CR 700.6)", () => {
        const state = board();
        const requirement =
            abstergoEntertainment.activatedAbilities![2].targetRequirement!;
        const offered = getLegalTargets(
            state,
            requirement,
            NO_TARGETING_SOURCE,
            "p1"
        )
            .map((t) => t.id)
            .sort();
        expect(offered).toEqual(["fable", "lutri", "memnite"]);
    });

    it("refuses a non-historic card at the accept gate", () => {
        const state = board();
        activate(state);
        expect(() =>
            applyOneTargetSelection(state, "p1", {
                targetType: "graveyard-card",
                targetId: "bears",
                targetPlayerId: "p1",
            })
        ).toThrow();
    });

    it("returns a legendary card to hand, then exiles every graveyard; the land is exiled as a cost", () => {
        const state = board();
        activate(state);
        applyOneTargetSelection(state, "p1", {
            targetType: "graveyard-card",
            targetId: "lutri",
            targetPlayerId: "p1",
        });
        // CR 602.2b / 601.2h — the cost is paid once targets are chosen.
        expect(ids(state.players[0].exile)).toEqual(["abstergo"]);
        resolveTopOfStack(state);
        expect(ids(state.players[0].hand)).toEqual(["lutri"]);
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(ids(state.players[0].exile)).toEqual([
            "abstergo",
            "bears",
            "fable",
            "memnite",
        ]);
        expect(ids(state.players[1].exile)).toEqual([
            "their-bears",
            "their-memnite",
        ]);
    });

    it('with no target chosen ("up to one") still exiles all graveyards (CR 601.2c)', () => {
        const state = board();
        activate(state);
        advanceTargetGroupOrFinalize(state, state.pendingTarget!, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(0);
    });

    it("an illegal target on resolution stops the whole ability — graveyards survive (CR 608.2b)", () => {
        const state = board();
        activate(state);
        applyOneTargetSelection(state, "p1", {
            targetType: "graveyard-card",
            targetId: "memnite",
            targetPlayerId: "p1",
        });
        // The target leaves the graveyard before resolution.
        const p1 = state.players[0];
        const memnite = p1.graveyard.find((c) => c.id === "memnite")!;
        p1.graveyard = p1.graveyard.filter((c) => c.id !== "memnite");
        p1.exile.push({ ...memnite, zone: "exile" });
        resolveTopOfStack(state);
        expect(ids(p1.graveyard)).toEqual(["bears", "fable", "lutri"]);
        expect(state.players[1].graveyard).toHaveLength(2);
    });
});
