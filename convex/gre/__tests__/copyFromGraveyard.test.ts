// CR 707.2 / 611.2a — `becomeCopy` whose SOURCE is a graveyard card, gated by a
// card-type tally at activation (CR 602.1b). Shifting Woodland is the fixture:
// nothing under test reads a card name.
//
//   - the gate counts distinct card types in the controller's own graveyard;
//   - the target is a permanent card (CR 110.4a) in that same graveyard;
//   - the copy shows the card's printed values, the card stays where it is, and
//     the permanent reverts at cleanup (CR 514.2);
//   - a target that left its zone makes the ability do nothing (CR 608.2b).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { activateAbilityOnState, applyOneTargetSelection } from "../../game";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import {
    activationConditionErrors,
    activationConditionHolds,
} from "../activationPrecondition";
import { presentedDefId } from "../copy";
import { getEffectivePower } from "../layers";
import { finalizeCleanup } from "../phases";
import { isManaAbilityDefinition } from "../constants";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../rules";
import { resolveTopOfStack } from "../state";
import { compactState, expandState } from "../serialize";
import type { EffectPredicate } from "../../cards/types";
import type { CardInstanceState, GameState } from "../state";

const WOODLAND = getCardByName("Shifting Woodland");
const COPY_ABILITY = "shifting-woodland-delirium-copy";
const ANGEL = getCardByName("Serra Angel").id; // Creature
const LOTUS = getCardByName("Black Lotus").id; // Artifact
const FOREST = getCardByName("Forest").id; // Land
const WRATH = getCardByName("Wrath of God").id; // Sorcery
const BEARS = getCardByName("Grizzly Bears").id; // Creature
const WORKER = getCardByName("Memnite").id; // Artifact Creature

function card(cardId: string, id: string, owner: "p1" | "p2") {
    return makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        isSummoningSick: false,
    });
}

/** Four card types among p1's graveyard: Creature, Artifact, Land, Sorcery. */
const DELIRIUM: Array<[string, string]> = [
    [ANGEL, "angel"],
    [LOTUS, "lotus"],
    [FOREST, "forest"],
    [WRATH, "wrath"],
];

function board(
    mine: Array<[string, string]> = DELIRIUM,
    theirs: Array<[string, string]> = []
): GameState {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [card(WOODLAND.id, "woodland", "p1")],
                graveyard: mine.map(([c, id]) => card(c, id, "p1")),
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 4, C: 0 },
            }),
            makePlayer("p2", {
                graveyard: theirs.map(([c, id]) => card(c, id, "p2")),
            }),
        ],
    });
}

/** CR 514.2 — the cleanup step's "until end of turn" boundary. */
function cleanup(state: GameState): void {
    state.phase = "CLEANUP";
    finalizeCleanup(state);
}

const woodland = (s: GameState): CardInstanceState =>
    s.players[0].battlefield.find((c) => c.id === "woodland")!;

function activate(state: GameState): void {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "woodland",
        abilityId: COPY_ABILITY,
    });
}

function selectGraveyard(state: GameState, id: string, owner = "p1"): void {
    applyOneTargetSelection(state, "p1", {
        targetType: "graveyard-card",
        targetId: id,
        targetPlayerId: owner,
    });
}

function copyAngel(): GameState {
    const state = board();
    activate(state);
    selectGraveyard(state, "angel");
    resolveTopOfStack(state);
    return state;
}

describe("Delirium activation gate (CR 602.1b)", () => {
    it("refuses with three card types and accepts with four", () => {
        expect(() => activate(board(DELIRIUM.slice(0, 3)))).toThrow(
            "Ability cannot be activated right now"
        );
        expect(() => activate(board())).not.toThrow();
    });

    it("counts distinct TYPES, not cards: four creatures are one type", () => {
        expect(() =>
            activate(
                board([
                    [BEARS, "a"],
                    [BEARS, "b"],
                    [BEARS, "c"],
                    [BEARS, "d"],
                ])
            )
        ).toThrow("Ability cannot be activated right now");
    });

    it("a multi-type card counts each of its types", () => {
        expect(() =>
            activate(
                board([
                    [WORKER, "worker"],
                    [FOREST, "forest"],
                    [WRATH, "wrath"],
                ])
            )
        ).not.toThrow();
    });

    it("reads YOUR graveyard (CR 109.5), never an opponent's", () => {
        expect(() => activate(board([], DELIRIUM))).toThrow(
            "Ability cannot be activated right now"
        );
    });
});

describe("activationCondition `countTypes` — the activation-time subset", () => {
    const tally = (scope: Record<string, unknown>): EffectPredicate =>
        ({
            left: { count: { zone: "graveyard", ...scope, countTypes: true } },
            op: "eq",
            right: 4,
        }) as EffectPredicate;

    it("tallies the UNION of the scoped graveyards, not a per-player sum", () => {
        const state = board(
            [
                [ANGEL, "angel"],
                [LOTUS, "lotus"],
            ],
            [
                [BEARS, "bears"],
                [FOREST, "forest"],
                [WRATH, "wrath"],
            ]
        );
        const source = woodland(state);
        expect(
            activationConditionErrors(tally({ acrossAllPlayers: true }))
        ).toEqual([]);
        expect(
            activationConditionHolds(
                state,
                source,
                tally({ acrossAllPlayers: true })
            )
        ).toBe(true);
    });

    it("refuses it outside a graveyard count, and any value but true", () => {
        expect(
            activationConditionErrors({
                left: {
                    count: {
                        zone: "hand",
                        controller: "controller",
                        countTypes: true,
                    },
                },
                op: "ge",
                right: 1,
            })
        ).not.toEqual([]);
        expect(
            activationConditionErrors({
                left: {
                    count: {
                        zone: "graveyard",
                        controller: "controller",
                        countTypes: false,
                    },
                },
                op: "ge",
                right: 1,
            })
        ).not.toEqual([]);
    });
});

describe("the printed type line", () => {
    it("is a bare Land whose {G} comes from its own mana ability", () => {
        expect(woodland(board()).subtypes).toEqual([]);
        const mana = WOODLAND.activatedAbilities!.find(
            (a) => a.id === "shifting-woodland-mana"
        )!;
        expect(isManaAbilityDefinition(mana)).toBe(true);
    });
});

describe("target permanent card in your graveyard (CR 110.4a)", () => {
    it("offers only the controller's own permanent cards", () => {
        const state = board(DELIRIUM, [[BEARS, "their-bears"]]);
        activate(state);
        const ids = getLegalTargets(
            state,
            WOODLAND.activatedAbilities!.find((a) => a.id === COPY_ABILITY)!
                .targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(ids.sort()).toEqual(["angel", "forest", "lotus"]);
    });

    it("the server refuses a nonpermanent card", () => {
        const state = board();
        activate(state);
        expect(() => selectGraveyard(state, "wrath")).toThrow();
    });
});

describe("becoming a copy of a graveyard card (CR 707.2 / 611.2a)", () => {
    it("presents the card's printed values; the card stays in the graveyard", () => {
        const state = copyAngel();
        const land = woodland(state);
        expect(presentedDefId(land)).toBe(ANGEL);
        expect(land.types).toEqual(["Creature"]);
        expect(land.staticAbilities).toEqual(
            expect.arrayContaining(["flying", "vigilance"])
        );
        expect(getEffectivePower(state, land)).toBe(4);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("angel");
    });

    it("reverts at cleanup (CR 514.2), on the battlefield as the same object", () => {
        const state = copyAngel();
        const before = woodland(state).id;
        cleanup(state);
        const land = woodland(state);
        expect(land.id).toBe(before);
        expect(presentedDefId(land)).toBe(WOODLAND.id);
        expect(land.types).toEqual(["Land"]);
        expect(land.copiedFrom).toBeUndefined();
        expect(land.timedCopyEffects).toBeUndefined();
    });

    it("does nothing when the target left the graveyard (CR 608.2b)", () => {
        const state = board();
        activate(state);
        selectGraveyard(state, "angel");
        const p1 = state.players[0];
        const gone = p1.graveyard.findIndex((c) => c.id === "angel");
        p1.exile.push(...p1.graveyard.splice(gone, 1));
        resolveTopOfStack(state);
        expect(presentedDefId(woodland(state))).toBe(WOODLAND.id);
        expect(woodland(state).copiedFrom).toBeUndefined();
    });

    it("crosses the wire and the save as the copied card, then as itself", () => {
        const state = expandState(compactState(copyAngel()));
        const projected = (s: GameState) =>
            projectPublicState(s, 1, "p1").players[0].battlefield.find(
                (c) => c.id === "woodland"
            )!;
        expect(projected(state).card).toMatchObject({ id: ANGEL });
        expect(projected(state).types).toEqual(["Creature"]);
        cleanup(state);
        expect(projected(state).card).toMatchObject({ id: WOODLAND.id });
        expect(projected(state).types).toEqual(["Land"]);
    });
});
